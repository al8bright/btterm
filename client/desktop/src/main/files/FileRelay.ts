import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { WebContents } from 'electron';
import { LocalEdits } from './LocalEdits';
import {
  baseRemote,
  type HostFilesOp,
  type LocalPlatform,
  type TransferState,
  type HostToMainControl,
  type MainToHostControl,
  type MainToRendererEvent,
  type Prompt,
  type PromptResponse,
  type RendererToMainRequest,
} from '@btterm/core';

type FilesRequest = Extract<
  RendererToMainRequest,
  {
    type:
      | 'files.op'
      | 'files.download'
      | 'files.upload'
      | 'transfer.cancel'
      | 'transfer.retry'
      | 'transfer.discard'
      | 'files.editLocal'
      | 'files.editUpload';
  }
>;
type FilesHostMessage = Extract<
  HostToMainControl,
  { type: 'filesResult' | 'transferStatus' | 'transferConflict' }
>;

interface FileRelayDeps {
  post(message: MainToHostControl): void;
  /** 세션을 연 창(다른 창의 세션은 다룰 수 없다) */
  ownerOf(sessionId: string): WebContents | undefined;
  isReady(sessionId: string): boolean;
  ask(sender: WebContents, prompt: Prompt): Promise<PromptResponse>;
  send(sender: WebContents, event: MainToRendererEvent): void;
  /** 다운로드 폴더 선택. 취소하면 null */
  chooseFolder(sender: WebContents): Promise<string | null>;
  /** 업로드 파일 선택. 취소하면 빈 배열 */
  chooseFiles(sender: WebContents): Promise<string[]>;
  /** renderer가 준 경로가 이 창에서 끌어 놓은 파일인지(보안 리뷰 #1) */
  consumeDropped(sender: WebContents, paths: readonly string[]): boolean;
  /** 파일 작업 응답 대기 상한(기본 60초) */
  opTimeoutMs?: number;
  /** 원격 파일 로컬 편집(F4.8, TR3). 없으면 쓸 수 없다 */
  edits?: {
    tempRoot: string;
    platform: LocalPlatform;
    openPath(path: string): Promise<boolean>;
    isFile(path: string): Promise<boolean>;
    watch(path: string, onChange: () => void): () => void;
    makeDir(path: string): Promise<void>;
    remove(path: string): Promise<void>;
  };
}

type OpResult = { ok: true; result: unknown } | { ok: false; error: string };

const DEFAULT_OP_TIMEOUT_MS = 60_000;

const FILES_TYPES = new Set([
  'files.op',
  'files.download',
  'files.upload',
  'transfer.cancel',
  'transfer.retry',
  'transfer.discard',
  'files.editLocal',
  'files.editUpload',
]);
const FINAL_STATES = new Set(['done', 'failed', 'cancelled', 'skipped']);
const HOST_TYPES = new Set(['filesResult', 'transferStatus', 'transferConflict']);

/** renderer ↔ session host 파일 작업·전송 중계(F4). 파일 바이트는 main을 거치지 않는다. */
export class FileRelay {
  readonly #deps: FileRelayDeps;
  /** requestId → 결과를 넘길 함수. 성공·실패 모두 이 함수로 끝낸다 */
  readonly #pending = new Map<string, (result: OpResult) => void>();
  readonly #transferOwners = new Map<string, WebContents>();
  /** 끝날 때까지 기다리는 전송(로컬 편집 받기) */
  readonly #waiters = new Map<string, (state: TransferState) => void>();
  readonly #edits: LocalEdits | null;

  constructor(deps: FileRelayDeps) {
    this.#deps = deps;
    this.#edits = deps.edits
      ? new LocalEdits({
          ...deps.edits,
          ids: () => randomUUID(),
          transfer: (sender, job) => this.#tracked(sender, job),
          send: (sender, event) => deps.send(sender, event),
        })
      : null;
  }

  /** 탭을 닫으면 그 세션의 로컬 편집을 정리한다 */
  async sessionClosed(sessionId: string): Promise<void> {
    await this.#edits?.closeSession(sessionId);
  }

  handles(request: RendererToMainRequest): request is FilesRequest {
    return FILES_TYPES.has(request.type);
  }

  handlesHost(message: HostToMainControl): message is FilesHostMessage {
    return HOST_TYPES.has(message.type);
  }

  async handle(sender: WebContents, request: FilesRequest): Promise<unknown> {
    if (
      request.type === 'transfer.cancel' ||
      request.type === 'transfer.retry' ||
      request.type === 'transfer.discard'
    ) {
      // 전송을 시작한 창만(실패한 전송은 정리할 때까지 주인을 기억한다, TR2)
      if (this.#transferOwners.get(request.transferId) !== sender)
        return { ok: false, error: 'not-found' };
      const type = {
        'transfer.cancel': 'transferCancel',
        'transfer.retry': 'transferRetry',
        'transfer.discard': 'transferDiscard',
      } as const;
      this.#deps.post({ type: type[request.type], transferId: request.transferId });
      if (request.type === 'transfer.discard') this.#transferOwners.delete(request.transferId);
      return { ok: true };
    }
    if (request.type === 'files.editUpload') {
      return this.#edits
        ? this.#edits.upload(sender, request.editId)
        : { ok: false, error: 'unavailable' };
    }
    if (
      this.#deps.ownerOf(request.sessionId) !== sender ||
      !this.#deps.isReady(request.sessionId)
    ) {
      return { ok: false, error: 'unavailable' };
    }
    if (request.type === 'files.editLocal') {
      if (!this.#edits) return { ok: false, error: 'unavailable' };
      return this.#edits.open(sender, request.sessionId, request.remotePath);
    }
    switch (request.type) {
      case 'files.op':
        return this.#op(request.sessionId, request.op);
      case 'files.download': {
        const targetDir = await this.#deps.chooseFolder(sender);
        if (!targetDir) return { ok: false, error: 'cancelled' };
        return this.#start(
          sender,
          request.remotePaths.map((path) => ({
            sessionId: request.sessionId,
            direction: 'download' as const,
            sourcePath: path,
            targetDir,
            name: baseRemote(path),
          })),
        );
      }
      case 'files.upload': {
        if (request.localPaths && !this.#deps.consumeDropped(sender, request.localPaths)) {
          return { ok: false, error: 'not-allowed' };
        }
        const localPaths = request.localPaths ?? (await this.#choose(sender, request.pick));
        if (localPaths.length === 0) return { ok: false, error: 'cancelled' };
        return this.#start(
          sender,
          localPaths.map((path) => ({
            sessionId: request.sessionId,
            direction: 'upload' as const,
            sourcePath: path,
            targetDir: request.remoteDir,
            name: basename(path),
          })),
        );
      }
    }
  }

  async handleHost(message: FilesHostMessage): Promise<void> {
    switch (message.type) {
      case 'filesResult':
        this.#pending.get(message.requestId)?.(
          message.ok ? { ok: true, result: message.result } : { ok: false, error: message.error },
        );
        return;
      case 'transferStatus': {
        // 폴더를 펼친 하위 전송은 폴더 한 줄로 보이므로 화면에 보내지 않는다(TR1)
        if (message.status.parentId !== undefined) return;
        const owner = this.#transferOwners.get(message.status.id);
        if (owner && !owner.isDestroyed()) {
          this.#deps.send(owner, { type: 'transfer.status', status: message.status });
        }
        if (FINAL_STATES.has(message.status.state)) {
          this.#waiters.get(message.status.id)?.(message.status.state);
          this.#waiters.delete(message.status.id);
        }
        if (['done', 'cancelled', 'skipped'].includes(message.status.state)) {
          this.#transferOwners.delete(message.status.id);
        }
        return;
      }
      case 'transferConflict': {
        const owner = this.#deps.ownerOf(message.sessionId);
        const answer = owner
          ? await this.#deps.ask(owner, {
              kind: 'fileConflict',
              name: message.name,
              direction: message.direction,
            })
          : { kind: 'cancel' as const };
        this.#deps.post({
          type: 'conflictAnswer',
          requestId: message.requestId,
          decision: answer.kind === 'conflict' ? answer.decision : 'skip',
          ...(answer.kind === 'conflict' && answer.applyAll !== undefined
            ? { applyAll: answer.applyAll }
            : {}),
        });
        return;
      }
    }
  }

  /** 올릴 파일 고르기. 폴더면 폴더 선택 창(F4.7) */
  async #choose(sender: WebContents, pick: 'files' | 'folder' | undefined): Promise<string[]> {
    if (pick !== 'folder') return this.#deps.chooseFiles(sender);
    const folder = await this.#deps.chooseFolder(sender);
    return folder ? [folder] : [];
  }

  /** 전송 하나를 시작하고 끝날 때까지 기다린다(전송 목록에도 보인다) */
  #tracked(
    sender: WebContents,
    job: Omit<Extract<MainToHostControl, { type: 'transfer' }>['job'], 'id'>,
  ): Promise<{ state: TransferState }> {
    return new Promise((resolve) => {
      const { transferIds } = this.#start(sender, [job]);
      this.#waiters.set(transferIds[0]!, (state) => resolve({ state }));
    });
  }

  /** session host가 끝나는 등 응답이 오지 않을 때 대기 중인 작업을 모두 끝낸다(보안 리뷰 #4). */
  failAll(error: string): void {
    for (const settle of [...this.#pending.values()]) settle({ ok: false, error });
    for (const settle of [...this.#waiters.values()]) settle('failed');
    this.#waiters.clear();
  }

  /** F7.8: 공개키를 그 세션 서버에 등록한다. 세션을 연 창만, 연결된 동안만 */
  installKey(sender: WebContents, sessionId: string, publicKey: string): Promise<OpResult> {
    if (this.#deps.ownerOf(sessionId) !== sender || !this.#deps.isReady(sessionId)) {
      return Promise.resolve({ ok: false, error: 'unavailable' });
    }
    return this.#op(sessionId, { kind: 'installKey', publicKey });
  }

  #op(sessionId: string, op: HostFilesOp): Promise<OpResult> {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const timer = setTimeout(
        () => settle({ ok: false, error: 'timeout' }),
        this.#deps.opTimeoutMs ?? DEFAULT_OP_TIMEOUT_MS,
      );
      const settle = (result: OpResult) => {
        clearTimeout(timer);
        this.#pending.delete(requestId);
        resolve(result);
      };
      this.#pending.set(requestId, settle);
      this.#deps.post({ type: 'files', requestId, sessionId, op });
    });
  }

  #start(
    sender: WebContents,
    jobs: Array<Omit<Extract<MainToHostControl, { type: 'transfer' }>['job'], 'id'>>,
  ): { ok: true; transferIds: string[] } {
    // 한 번의 요청이 한 배치: 충돌 "모두 적용"은 이 안에서만 쓴다(F4.3b).
    const batchId = randomUUID();
    const transferIds = jobs.map((job) => {
      const id = randomUUID();
      this.#transferOwners.set(id, sender);
      this.#deps.post({ type: 'transfer', job: { id, batchId, ...job } });
      return id;
    });
    return { ok: true, transferIds };
  }
}
