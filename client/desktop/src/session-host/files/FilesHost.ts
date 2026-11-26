import { randomUUID } from 'node:crypto';
import {
  RemoteFiles,
  SftpError,
  TransferQueue,
  type ConflictAnswer,
  type HostSession,
  type HostToMainControl,
  type MainToHostControl,
  type ResourceTracker,
  type SftpSession,
} from '@btterm/core';
import { localPlatform } from '../../platform/paths';
import { nodeClock } from '../../shared/nodeClock';
import { createTransferEndpoints } from './transferEndpoints';

interface FilesHostDeps {
  session(sessionId: string): HostSession | undefined;
  post(message: HostToMainControl): void;
  tracker: ResourceTracker;
}

/**
 * session host의 파일 작업(F4.1, F4.2, F4.5)과 전송 큐(F4.4).
 * 세션마다 탐색용·전송용 SFTP 채널을 따로 연다.
 */
export class FilesHost {
  readonly #deps: FilesHostDeps;
  readonly #files = new Map<string, RemoteFiles>();
  readonly #transferChannels = new Map<string, Promise<SftpSession>>();
  readonly #conflicts = new Map<string, (answer: ConflictAnswer) => void>();
  readonly #queue: TransferQueue;

  constructor(deps: FilesHostDeps) {
    this.#deps = deps;
    this.#queue = new TransferQueue({
      endpoints: createTransferEndpoints((sessionId) => this.#transferChannel(sessionId)),
      clock: nodeClock,
      tracker: deps.tracker,
      platform: localPlatform(),
      ids: { next: () => randomUUID() },
      askConflict: (job, name) =>
        new Promise((resolve) => {
          const requestId = randomUUID();
          this.#conflicts.set(requestId, resolve);
          deps.post({
            type: 'transferConflict',
            requestId,
            sessionId: job.sessionId,
            name,
            direction: job.direction,
          });
        }),
      onStatus: (status) => deps.post({ type: 'transferStatus', status }),
    });
  }

  async handle(
    message: Extract<
      MainToHostControl,
      {
        type:
          | 'files'
          | 'transfer'
          | 'transferCancel'
          | 'transferRetry'
          | 'transferDiscard'
          | 'conflictAnswer';
      }
    >,
  ): Promise<void> {
    switch (message.type) {
      case 'files':
        await this.#runOp(message);
        return;
      case 'transfer':
        this.#queue.enqueue(message.job);
        return;
      case 'transferCancel':
        this.#queue.cancel(message.transferId);
        return;
      case 'transferRetry':
        this.#queue.retry(message.transferId);
        return;
      case 'transferDiscard':
        this.#queue.discard(message.transferId);
        return;
      case 'conflictAnswer': {
        const resolve = this.#conflicts.get(message.requestId);
        this.#conflicts.delete(message.requestId);
        resolve?.({
          decision: message.decision,
          ...(message.applyAll !== undefined ? { applyAll: message.applyAll } : {}),
        });
        return;
      }
    }
  }

  /** 탭을 닫으면 그 세션의 실패한 전송 부분 파일을 지운다(보안 리뷰 L2). 재접속 때는 부르지 않는다 */
  discardSession(sessionId: string): Promise<void> {
    return this.#queue.discardSession(sessionId);
  }

  /** 세션이 끝나면 채널을 닫는다. 진행 중 전송은 채널 오류로 실패 처리된다. */
  sessionEnded(sessionId: string): void {
    this.#files.get(sessionId)?.close();
    this.#files.delete(sessionId);
    const channel = this.#transferChannels.get(sessionId);
    this.#transferChannels.delete(sessionId);
    void channel?.then(
      (sftp) => sftp.close(),
      () => undefined,
    );
  }

  dispose(): void {
    this.#queue.dispose();
    for (const id of [...this.#files.keys(), ...this.#transferChannels.keys()])
      this.sessionEnded(id);
  }

  async #runOp(message: Extract<MainToHostControl, { type: 'files' }>): Promise<void> {
    const { requestId, sessionId, op } = message;
    try {
      const result = await this.#remoteFiles(sessionId).run(op);
      this.#deps.post({ type: 'filesResult', requestId, ok: true, result: result ?? null });
    } catch (error) {
      const code = error instanceof SftpError ? error.code : 'unavailable';
      this.#deps.post({ type: 'filesResult', requestId, ok: false, error: code });
    }
  }

  #remoteFiles(sessionId: string): RemoteFiles {
    let files = this.#files.get(sessionId);
    if (!files) {
      files = new RemoteFiles(() => this.#open(sessionId));
      this.#files.set(sessionId, files);
    }
    return files;
  }

  #transferChannel(sessionId: string): Promise<SftpSession> {
    let channel = this.#transferChannels.get(sessionId);
    if (!channel) {
      channel = this.#open(sessionId);
      channel.catch(() => this.#transferChannels.delete(sessionId));
      this.#transferChannels.set(sessionId, channel);
    }
    return channel;
  }

  #open(sessionId: string): Promise<SftpSession> {
    const session = this.#deps.session(sessionId);
    if (!session) return Promise.reject(new SftpError('failure', '세션 없음'));
    return session.openSftp();
  }
}
