import { join } from 'node:path';
import type { WebContents } from 'electron';
import {
  baseRemote,
  isExecutableName,
  parentRemote,
  toLocalFileName,
  type LocalPlatform,
  type MainToRendererEvent,
  type TransferJob,
  type TransferState,
} from '@btterm/core';

type JobInput = Omit<TransferJob, 'id' | 'batchId'>;

interface LocalEditsDeps {
  /** 앱 데이터 아래 편집용 임시 폴더 */
  tempRoot: string;
  platform: LocalPlatform;
  ids(): string;
  /** 전송 큐로 보내고 끝날 때까지 기다린다(전송 목록에도 보인다) */
  transfer(sender: WebContents, job: JobInput): Promise<{ state: TransferState }>;
  /** OS 기본 앱으로 연다(main/external, 실행 파일은 거부) */
  openPath(path: string): Promise<boolean>;
  /** 링크가 아닌 일반 파일인지(lstat) */
  isFile(path: string): Promise<boolean>;
  /** 파일이 바뀌면 onChange. 돌려준 함수로 감시를 멈춘다 */
  watch(path: string, onChange: () => void): () => void;
  makeDir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  send(sender: WebContents, event: MainToRendererEvent): void;
}

interface Edit {
  owner: WebContents;
  sessionId: string;
  remotePath: string;
  name: string;
  dir: string;
  localPath: string;
  unwatch(): void;
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * 원격 파일 로컬 편집(F4.8, 결정 TR3): 임시 폴더로 받아 기본 앱으로 열고, 저장하면 연 창에 알린다.
 * 업로드는 사용자가 누를 때만, 원래 자리에 확인 없이 바꿔 넣는다(전송은 원자적 교체).
 */
export class LocalEdits {
  readonly #deps: LocalEditsDeps;
  readonly #edits = new Map<string, Edit>();
  /** 닫힌 세션. 세션 ID는 다시 쓰이지 않는다 */
  readonly #closed = new Set<string>();

  constructor(deps: LocalEditsDeps) {
    this.#deps = deps;
  }

  async open(
    owner: WebContents,
    sessionId: string,
    remotePath: string,
  ): Promise<{ ok: true; editId: string } | { ok: false; error: string }> {
    const name = baseRemote(remotePath);
    const local = toLocalFileName(name, this.#deps.platform);
    if (!local.ok) return { ok: false, error: 'invalid-name' };
    // SEC-11: 실행할 수 있는 파일은 기본 앱으로 열면 실행된다
    if (isExecutableName(local.name, this.#deps.platform))
      return { ok: false, error: 'blocked-type' };

    const editId = this.#deps.ids();
    const dir = join(this.#deps.tempRoot, editId);
    await this.#deps.makeDir(dir);
    const received = await this.#deps.transfer(owner, {
      sessionId,
      direction: 'download',
      sourcePath: remotePath,
      targetDir: dir,
      name,
    });
    // 받는 동안 탭이 닫혔으면 아무도 정리하지 않으니 여기서 지운다(보안 리뷰 L3)
    if (this.#closed.has(sessionId)) return this.#fail(dir, 'closed');
    if (received.state !== 'done') return this.#fail(dir, 'download-failed');
    const localPath = join(dir, local.name);
    // 원격이 폴더·링크였으면 내려받은 폴더를 탐색기로 열게 된다(보안 리뷰 M1)
    if (!(await this.#deps.isFile(localPath))) return this.#fail(dir, 'not-a-file');
    if (!(await this.#deps.openPath(localPath))) return this.#fail(dir, 'no-app');

    const unwatch = this.#deps.watch(localPath, () => {
      if (!owner.isDestroyed()) {
        this.#deps.send(owner, { type: 'files.editChanged', editId, sessionId, name });
      }
    });
    this.#edits.set(editId, { owner, sessionId, remotePath, name, dir, localPath, unwatch });
    return { ok: true, editId };
  }

  /** 연 창만 올릴 수 있다 */
  async upload(owner: WebContents, editId: string): Promise<Result> {
    const edit = this.#edits.get(editId);
    if (!edit || edit.owner !== owner) return { ok: false, error: 'not-found' };
    void this.#deps.transfer(owner, {
      sessionId: edit.sessionId,
      direction: 'upload',
      sourcePath: edit.localPath,
      targetDir: parentRemote(edit.remotePath),
      name: edit.name,
      overwrite: true,
    });
    return { ok: true };
  }

  /** 탭을 닫으면 그 세션의 감시를 멈추고 임시 파일을 지운다 */
  async closeSession(sessionId: string): Promise<void> {
    this.#closed.add(sessionId);
    const closing = [...this.#edits].filter(([, edit]) => edit.sessionId === sessionId);
    await Promise.all(closing.map(([id, edit]) => this.#close(id, edit)));
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.#edits].map(([id, edit]) => this.#close(id, edit)));
  }

  async #close(editId: string, edit: Edit): Promise<void> {
    this.#edits.delete(editId);
    edit.unwatch();
    await this.#deps.remove(edit.dir).catch(() => undefined);
  }

  async #fail(dir: string, error: string): Promise<{ ok: false; error: string }> {
    await this.#deps.remove(dir).catch(() => undefined);
    return { ok: false, error };
  }
}
