import type { IdGenerator } from '../id/IdGenerator';
import type { Disposable, ResourceTracker } from '../resource/ResourceTracker';
import type { Clock } from '../time/Clock';
import { toLocalFileName, uniqueName, type LocalPlatform } from './localName';

export type TransferDirection = 'upload' | 'download';

export interface TransferJob {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  /** 원본 전체 경로(다운로드면 원격, 업로드면 로컬) */
  sourcePath: string;
  /** 대상 폴더(다운로드면 로컬, 업로드면 원격) */
  targetDir: string;
  /** 원하는 대상 이름(원본 파일명) */
  name: string;
  /** 한 번의 사용자 요청으로 만든 작업 묶음. "모두 적용"은 이 범위에만 쓴다(F4.3b) */
  batchId?: string | undefined;
  /** 폴더를 펼쳐 생긴 작업이면 그 폴더 작업(TR1) */
  parentId?: string | undefined;
  /** 폴더 깊이(맨 위 = 0) */
  depth?: number | undefined;
  /** 같은 이름이 있어도 묻지 않고 바꿔 넣는다(사용자가 이미 확인한 로컬 편집 업로드, TR3) */
  overwrite?: boolean | undefined;
}

export type TransferState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';

export interface TransferStatus {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  name: string;
  state: TransferState;
  bytes: number;
  total: number;
  error?: string | undefined;
  /** 폴더 작업이면 bytes·total은 끝난 파일 수·찾은 파일 수(TR1) */
  folder?: boolean | undefined;
  /** 폴더를 펼쳐 생긴 작업. 화면은 맨 위 작업만 보여 준다 */
  parentId?: string | undefined;
}

/** 원본 종류. 링크·특수 파일은 따라가지 않고 건너뛴다(TR1) */
export type SourceKind = 'file' | 'dir' | 'skip';

export interface TransferChild {
  name: string;
  /** 원본 전체 경로 */
  path: string;
  kind: SourceKind;
}

export interface TransferSource {
  size: number;
  /** 끝이면 null */
  read(maxBytes: number): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

export interface TransferSink {
  write(chunk: Uint8Array): Promise<void>;
  /** 완료: 임시 파일을 제자리로 */
  finish(): Promise<void>;
  /** 취소: 부분 파일을 지운다 */
  abort(): Promise<void>;
  /** 실패: 이어받을 수 있게 부분 파일을 남기고 닫는다(TR2) */
  keep(): Promise<void>;
}

/** 실제 입출력(원격 SFTP·로컬 파일)은 session host가 꽂는다. */
export interface TransferEndpoints {
  kindOf(job: TransferJob): Promise<SourceKind>;
  /** 폴더 안 항목 */
  children(job: TransferJob): Promise<TransferChild[]>;
  /** 대상 폴더 아래에 name 폴더를 만들고(있으면 그대로) 그 경로를 돌려준다 */
  makeDir(job: TransferJob, name: string): Promise<string>;
  /** offset: 이어받기 시작 지점(TR2) */
  openSource(job: TransferJob, offset?: number): Promise<TransferSource>;
  targetNames(job: TransferJob): Promise<ReadonlySet<string>>;
  /** offset > 0이면 남은 부분 파일의 그 지점부터 잇는다 */
  openSink(job: TransferJob, name: string, offset?: number): Promise<TransferSink>;
  /** 대상 name으로 남은 부분 파일 크기(없으면 0) */
  partSize(job: TransferJob, name: string): Promise<number>;
  discardPart(job: TransferJob, name: string): Promise<void>;
}

export type ConflictDecision = 'overwrite' | 'skip' | 'rename';
export interface ConflictAnswer {
  decision: ConflictDecision;
  /** F4.3b: 같은 세션의 이후 충돌에도 적용 */
  applyAll?: boolean;
}

interface QueueOptions {
  endpoints: TransferEndpoints;
  clock: Clock;
  tracker: ResourceTracker;
  platform: LocalPlatform;
  askConflict(job: TransferJob, name: string): Promise<ConflictAnswer>;
  onStatus(status: TransferStatus): void;
  concurrency?: number;
  chunkSize?: number;
  /** 폴더를 펼친 하위 작업 id */
  ids: IdGenerator;
  /** 한 배치에서 펼칠 수 있는 항목 수(기본 1만, TR1) */
  maxBatchFiles?: number;
}

const PROGRESS_INTERVAL_MS = 250;
const MAX_DEPTH = 32;
const MAX_BATCH_FILES = 10_000;
/** 탐색기로 지우기 어려운 아주 긴 경로를 만들지 않는다(보안 리뷰 L4) */
const MAX_TARGET_PATH = 1024;

/** 펼친 폴더: 남은 하위 작업과 파일 진행(하위 폴더의 파일까지) */
interface Folder {
  job: TransferJob;
  pending: Set<string>;
  done: number;
  total: number;
  failed: boolean;
  cancelled: boolean;
  lastReport: number;
}

const FINAL_STATES: readonly TransferState[] = ['done', 'failed', 'cancelled', 'skipped'];

/** 실패한 파일 전송: 다시 시도하면 name(부분 파일)에서 잇는다(TR2) */
interface Failed {
  job: TransferJob;
  /** 부분 파일을 남긴 대상 이름. 받는 쪽을 열기 전에 실패했으면 null */
  name: string | null;
  total: number;
  /** 실패한 동안에도 대상 이름을 잡아 둔다: 다른 전송이 같은 부분 파일에 쓰지 않게(보안 리뷰 M2) */
  reservedKey: string | null;
}

interface Running {
  job: TransferJob;
  cancelled: boolean;
}

/**
 * 전송 큐(F4.4): 동시 실행 수 제한, 진행률 알림 제한(250ms), 취소 시 부분 파일 제거(AC11),
 * 충돌 질의(F4.3)와 "모두 적용", 다운로드 파일명 정규화(SEC-11).
 */
export class TransferQueue implements Disposable {
  readonly #options: QueueOptions;
  readonly #waiting: TransferJob[] = [];
  readonly #running = new Map<string, Running>();
  readonly #applyAll = new Map<string, ConflictDecision>();
  /** 진행 중인 작업이 쓰고 있는 대상(폴더 + 이름). 동시에 같은 이름을 쓰지 않게 한다 */
  readonly #reserved = new Set<string>();
  readonly #folders = new Map<string, Folder>();
  readonly #batchItems = new Map<string, number>();
  readonly #failed = new Map<string, Failed>();
  /** 실패로 끝난 폴더(다시 시도하면 실패한 하위 전송만) */
  readonly #failedFolders = new Map<string, { job: TransferJob; done: number; total: number }>();
  /** 하위 작업 → 폴더 작업(폴더가 끝난 뒤에도 다시 시도·정리에 쓴다) */
  readonly #parentOf = new Map<string, string>();
  /** 이번 실행에서 대상 이름(부분 파일)을 정한 작업 */
  readonly #targetOf = new Map<string, string>();
  /** 다시 시도할 때 이어 쓸 대상 이름 */
  readonly #resume = new Map<string, { name: string; total: number }>();
  readonly #handle: Disposable;
  #disposed = false;

  constructor(options: QueueOptions) {
    this.#options = options;
    this.#handle = options.tracker.track('transfer-queue');
  }

  enqueue(job: TransferJob): void {
    this.#waiting.push(job);
    this.#emit(job, 'queued', 0, 0);
    this.#pump();
  }

  /** 1초 안에 멈춘다: 다음 조각을 읽기 전에 확인하고 부분 파일을 버린다. 폴더면 남은 하위 작업도. */
  cancel(id: string): void {
    const folder = this.#folders.get(id);
    if (folder) {
      folder.cancelled = true;
      for (const child of [...folder.pending]) this.cancel(child);
      return;
    }
    const running = this.#running.get(id);
    if (running) {
      running.cancelled = true;
      return;
    }
    const index = this.#waiting.findIndex((j) => j.id === id);
    if (index >= 0) {
      const [job] = this.#waiting.splice(index, 1);
      if (job) this.#emit(job, 'cancelled', 0, 0);
    }
  }

  /**
   * 실패한 전송을 다시 시도한다(TR2). 파일이면 남은 부분 파일에서 잇고,
   * 폴더면 그 아래 실패한 하위 전송만 다시 넣고 폴더 줄을 다시 연다.
   */
  retry(id: string): void {
    const folder = this.#failedFolders.get(id);
    if (folder) {
      this.#retryFolder(id, folder);
      return;
    }
    const failed = this.#failed.get(id);
    if (!failed) return;
    this.#takeFailed(failed);
    if (failed.name !== null) this.#resume.set(id, { name: failed.name, total: failed.total });
    this.enqueue(failed.job);
  }

  /** 탭을 닫으면 그 세션의 실패한 전송 부분 파일을 지운다(보안 리뷰 L2) */
  async discardSession(sessionId: string): Promise<void> {
    for (const [id, folder] of [...this.#failedFolders]) {
      if (folder.job.sessionId === sessionId) this.#failedFolders.delete(id);
    }
    await Promise.all(
      [...this.#failed.values()]
        .filter((failed) => failed.job.sessionId === sessionId)
        .map((failed) => this.#dropFailed(failed)),
    );
  }

  /** 실패한 전송을 목록에서 정리한다: 남은 부분 파일을 지운다(TR2). 폴더면 그 아래 전부 */
  discard(id: string): void {
    const targets = this.#failedFolders.has(id)
      ? [...this.#failed.values()].filter((f) => this.#isUnder(f.job.id, id))
      : [this.#failed.get(id)].filter((f): f is Failed => f !== undefined);
    this.#failedFolders.delete(id);
    for (const failed of targets) void this.#dropFailed(failed);
  }

  dispose(): void {
    this.#disposed = true;
    for (const failed of [...this.#failed.values()]) void this.#dropFailed(failed);
    for (const job of this.#waiting.splice(0)) this.#emit(job, 'cancelled', 0, 0);
    for (const running of this.#running.values()) running.cancelled = true;
    this.#handle.dispose();
  }

  #pump(): void {
    const limit = this.#options.concurrency ?? 3;
    while (!this.#disposed && this.#running.size < limit && this.#waiting.length > 0) {
      const job = this.#waiting.shift()!;
      const running: Running = { job, cancelled: false };
      this.#running.set(job.id, running);
      void this.#run(running).finally(() => {
        this.#running.delete(job.id);
        this.#pump();
      });
    }
  }

  #retryFolder(id: string, failed: { job: TransferJob; done: number; total: number }): void {
    this.#failedFolders.delete(id);
    for (const key of [...this.#failedFolders.keys()]) {
      if (this.#isUnder(key, id)) this.#failedFolders.delete(key);
    }
    const folder: Folder = {
      job: failed.job,
      pending: new Set(),
      done: failed.done,
      total: failed.total,
      failed: false,
      cancelled: false,
      lastReport: this.#options.clock.now(),
    };
    this.#folders.set(id, folder);
    const children = [...this.#failed.values()].filter((f) => this.#isUnder(f.job.id, id));
    for (const child of children) folder.pending.add(child.job.id);
    this.#reportFolder(folder, true);
    for (const child of children) {
      this.#takeFailed(child);
      // 중간 폴더는 이미 끝났으므로 다시 시도한 폴더 아래로 바로 모은다
      const job = { ...child.job, parentId: id };
      if (child.name !== null) this.#resume.set(job.id, { name: child.name, total: child.total });
      this.enqueue(job);
    }
    if (folder.pending.size === 0) this.#finishFolder(folder);
  }

  #isUnder(jobId: string, ancestorId: string): boolean {
    for (let id = this.#parentOf.get(jobId); id !== undefined; id = this.#parentOf.get(id)) {
      if (id === ancestorId) return true;
    }
    return false;
  }

  /** 실패 목록에서 꺼내고 잡아 둔 이름을 푼다(다시 시도는 이어 쓸 수 있는지 다시 확인한다) */
  #takeFailed(failed: Failed): void {
    this.#failed.delete(failed.job.id);
    if (failed.reservedKey !== null) this.#reserved.delete(failed.reservedKey);
  }

  async #dropFailed(failed: Failed): Promise<void> {
    this.#takeFailed(failed);
    if (failed.name !== null) {
      await this.#options.endpoints.discardPart(failed.job, failed.name).catch(() => undefined);
    }
  }

  async #run(running: Running): Promise<void> {
    const { job } = running;
    const resume = this.#resume.get(job.id);
    this.#resume.delete(job.id);
    const name = this.#targetName(job);
    if (name === null) {
      this.#emit(job, 'failed', 0, 0, 'invalid-name');
      return;
    }
    let kind: SourceKind;
    try {
      kind = await this.#options.endpoints.kindOf(job);
    } catch (error) {
      this.#emit(job, 'failed', 0, 0, errorCode(error));
      return;
    }
    if (kind === 'skip') {
      this.#emit(job, 'skipped', 0, 0);
      return;
    }
    if (kind === 'dir') {
      await this.#expand(running, name);
      return;
    }
    // 다시 시도: 남은 부분 파일 크기에서 잇는다. 그 이름을 다른 전송이 쓰거나 대상에 같은 이름이
    // 생겼으면 이어 붙이지 않고 새 이름 확인부터(보안 리뷰 M2)
    let offset = 0;
    let resumeName: string | null = null;
    if (resume) {
      const taken =
        this.#reserved.has(this.#reserveKey(job, resume.name)) ||
        (await this.#options.endpoints
          .targetNames(job)
          .then((names) => names.has(resume.name))
          .catch(() => true));
      if (!taken) {
        resumeName = resume.name;
        const part = await this.#options.endpoints.partSize(job, resume.name).catch(() => 0);
        offset = part > 0 && part <= resume.total ? part : 0;
      }
    }
    let source: TransferSource;
    try {
      source = await this.#options.endpoints.openSource(job, offset);
      // 원본 크기가 실패 때와 다르면(원본이 바뀜) 앞부분이 맞는다고 볼 수 없어 처음부터
      if (offset > source.size || (resume && offset > 0 && source.size !== resume.total)) {
        await source.close().catch(() => undefined);
        offset = 0;
        source = await this.#options.endpoints.openSource(job, 0);
      }
    } catch (error) {
      this.#emit(job, 'failed', 0, 0, errorCode(error));
      return;
    }
    let sink: TransferSink | null = null;
    let reservedKey: string | null = null;
    let bytes = offset;
    try {
      const finalName =
        resumeName !== null ? this.#reserve(job, resumeName) : await this.#claimName(job, name);
      if (finalName === null) {
        this.#emit(job, 'skipped', 0, source.size);
        return;
      }
      reservedKey = this.#reserveKey(job, finalName);
      this.#targetOf.set(job.id, finalName);
      sink = await this.#options.endpoints.openSink(job, finalName, offset);
      this.#emit(job, 'running', bytes, source.size);
      let lastReport = this.#options.clock.now();
      for (;;) {
        if (running.cancelled) {
          await sink.abort();
          this.#emit(job, 'cancelled', bytes, source.size);
          return;
        }
        const chunk = await source.read(this.#options.chunkSize ?? 256 * 1024);
        if (chunk === null) break;
        await sink.write(chunk);
        bytes += chunk.length;
        const now = this.#options.clock.now();
        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now;
          this.#emit(job, 'running', bytes, source.size);
        }
      }
      await sink.finish();
      this.#emit(job, 'done', bytes, source.size);
    } catch (error) {
      // 실패는 부분 파일을 남겨 "다시 시도"가 이어받게 한다(TR2). 취소는 위에서 지운다
      await sink?.keep().catch(() => undefined);
      this.#emit(job, 'failed', bytes, source.size, errorCode(error));
      const failed = this.#failed.get(job.id);
      if (failed && sink) {
        failed.reservedKey = reservedKey;
        reservedKey = null;
      }
    } finally {
      this.#targetOf.delete(job.id);
      if (reservedKey !== null) this.#reserved.delete(reservedKey);
      await source.close().catch(() => undefined);
    }
  }

  /**
   * 폴더를 대상에 만들고 안의 항목을 같은 배치의 하위 작업으로 넣는다(TR1).
   * 깊이·항목 수 상한을 넘으면 더 펼치지 않는다.
   */
  async #expand(running: Running, name: string): Promise<void> {
    const { job } = running;
    const depth = job.depth ?? 0;
    if (depth >= MAX_DEPTH) {
      this.#emit(job, 'failed', 0, 0, 'too-deep');
      return;
    }
    let dir: string;
    let entries: TransferChild[];
    try {
      dir = await this.#options.endpoints.makeDir(job, name);
      entries = await this.#options.endpoints.children(job);
    } catch (error) {
      this.#emit(job, 'failed', 0, 0, errorCode(error));
      return;
    }
    if (running.cancelled) {
      this.#emit(job, 'cancelled', 0, 0, undefined, true);
      return;
    }
    if (dir.length > MAX_TARGET_PATH) {
      this.#emit(job, 'failed', 0, 0, 'too-deep', true);
      return;
    }
    const batch = job.batchId ?? job.id;
    const counted = (this.#batchItems.get(batch) ?? 0) + entries.length;
    if (counted > (this.#options.maxBatchFiles ?? MAX_BATCH_FILES)) {
      this.#emit(job, 'failed', 0, 0, 'too-many', true);
      return;
    }
    this.#batchItems.set(batch, counted);

    const folder: Folder = {
      job,
      pending: new Set(),
      done: 0,
      total: 0,
      failed: false,
      cancelled: false,
      lastReport: this.#options.clock.now(),
    };
    this.#folders.set(job.id, folder);
    const children = entries.map((entry): [TransferJob, SourceKind] => [
      {
        id: this.#options.ids.next(),
        sessionId: job.sessionId,
        direction: job.direction,
        sourcePath: entry.path,
        targetDir: dir,
        name: entry.name,
        batchId: batch,
        parentId: job.id,
        depth: depth + 1,
      },
      entry.kind,
    ]);
    this.#addFiles(job.id, children.filter(([, kind]) => kind === 'file').length);
    this.#reportFolder(folder, true);
    for (const [child] of children) {
      folder.pending.add(child.id);
      this.#parentOf.set(child.id, job.id);
    }
    for (const [child, kind] of children) {
      if (kind === 'skip') this.#emit(child, 'skipped', 0, 0);
      else this.enqueue(child);
    }
    if (folder.pending.size === 0) this.#finishFolder(folder);
  }

  /** 폴더와 그 위 폴더들의 찾은 파일 수를 늘린다 */
  #addFiles(folderId: string | undefined, count: number): void {
    for (let id = folderId; id !== undefined;) {
      const folder = this.#folders.get(id);
      if (!folder) return;
      folder.total += count;
      id = folder.job.parentId;
    }
  }

  /** 하위 작업이 끝나면 부모 폴더의 남은 작업에서 빼고, 파일이면 진행을 올린다 */
  #childSettled(job: TransferJob, state: TransferState, isFolder: boolean): void {
    const parent = job.parentId ? this.#folders.get(job.parentId) : undefined;
    if (!parent || !parent.pending.delete(job.id)) return;
    if (state === 'failed') parent.failed = true;
    if (!isFolder && state === 'done') {
      for (let f: Folder | undefined = parent; f;) {
        f.done += 1;
        this.#reportFolder(f, false);
        f = f.job.parentId ? this.#folders.get(f.job.parentId) : undefined;
      }
    }
    if (parent.pending.size === 0) this.#finishFolder(parent);
  }

  #finishFolder(folder: Folder): void {
    this.#folders.delete(folder.job.id);
    if (folder.failed && !folder.cancelled) {
      this.#failedFolders.set(folder.job.id, {
        job: folder.job,
        done: folder.done,
        total: folder.total,
      });
    }
    if (folder.job.parentId === undefined)
      this.#batchItems.delete(folder.job.batchId ?? folder.job.id);
    const state: TransferState = folder.cancelled ? 'cancelled' : folder.failed ? 'failed' : 'done';
    this.#emit(folder.job, state, folder.done, folder.total, undefined, true);
  }

  /** 폴더 진행은 250ms마다(처음은 바로) */
  #reportFolder(folder: Folder, force: boolean): void {
    const now = this.#options.clock.now();
    if (!force && now - folder.lastReport < PROGRESS_INTERVAL_MS) return;
    folder.lastReport = now;
    this.#options.onStatus(
      this.#status(folder.job, 'running', folder.done, folder.total, undefined, true),
    );
  }

  /** 다운로드는 로컬 파일명으로 정규화(SEC-11), 업로드는 원격 이름에서 경로 구분자만 막는다. */
  #targetName(job: TransferJob): string | null {
    if (job.direction === 'download') {
      const local = toLocalFileName(job.name, this.#options.platform);
      return local.ok ? local.name : null;
    }
    return job.name === '' || job.name === '.' || job.name === '..' || job.name.includes('/')
      ? null
      : job.name;
  }

  /**
   * 대상 이름을 정하고 예약한다(충돌 시 질의). 확인과 예약 사이에 await가 없어야
   * 동시에 도는 작업이 같은 이름을 고르지 않는다.
   */
  async #claimName(job: TransferJob, name: string): Promise<string | null> {
    const onTarget = await this.#options.endpoints.targetNames(job);
    const platform = job.direction === 'download' ? this.#options.platform : 'posix';
    if (uniqueName(name, this.#taken(job, onTarget), platform) === name)
      return this.#reserve(job, name);

    // 로컬 편집 업로드: 사용자가 이미 확인했다. 다른 전송이 쓰는 중인 이름만 피한다
    if (job.overwrite && !this.#reserved.has(this.#reserveKey(job, name))) {
      return this.#reserve(job, name);
    }
    const scope = `${job.batchId ?? job.id}:${job.direction}`;
    const remembered = this.#applyAll.get(scope);
    const answer = remembered
      ? { decision: remembered }
      : await this.#options.askConflict(job, name);
    if (answer.applyAll) this.#applyAll.set(scope, answer.decision);
    if (answer.decision === 'skip') return null;
    // 다른 작업이 지금 쓰고 있는 이름은 덮어쓰지 않고 새 이름을 쓴다.
    if (answer.decision === 'overwrite' && !this.#reserved.has(this.#reserveKey(job, name))) {
      return this.#reserve(job, name);
    }
    return this.#reserve(job, uniqueName(name, this.#taken(job, onTarget), platform));
  }

  /** 대상 폴더에 이미 있는 이름 + 다른 작업이 예약한 이름 */
  #taken(job: TransferJob, onTarget: ReadonlySet<string>): Set<string> {
    const taken = new Set(onTarget);
    const dir = this.#dirKey(job);
    for (const key of this.#reserved) {
      const [reservedDir, reservedName] = splitReserveKey(key);
      if (reservedDir === dir) taken.add(reservedName);
    }
    return taken;
  }

  #reserve(job: TransferJob, name: string): string {
    this.#reserved.add(this.#reserveKey(job, name));
    return name;
  }

  /** 같은 폴더인지 비교할 키. Windows 로컬 폴더는 대소문자를 가리지 않는다(보안 리뷰 L2) */
  #dirKey(job: TransferJob): string {
    const local = job.direction === 'download' && this.#options.platform === 'windows';
    return local ? job.targetDir.toLowerCase() : job.targetDir;
  }

  #reserveKey(job: TransferJob, name: string): string {
    return `${this.#dirKey(job)}${RESERVE_SEPARATOR}${name}`;
  }

  #emit(
    job: TransferJob,
    state: TransferState,
    bytes: number,
    total: number,
    error?: string,
    folder = false,
  ) {
    this.#options.onStatus(this.#status(job, state, bytes, total, error, folder));
    if (state === 'failed' && !folder) {
      this.#failed.set(job.id, {
        job,
        name: this.#targetOf.get(job.id) ?? null,
        total,
        reservedKey: null,
      });
    }
    if (FINAL_STATES.includes(state)) this.#childSettled(job, state, folder);
  }

  #status(
    job: TransferJob,
    state: TransferState,
    bytes: number,
    total: number,
    error: string | undefined,
    folder: boolean,
  ): TransferStatus {
    return {
      id: job.id,
      sessionId: job.sessionId,
      direction: job.direction,
      name: job.name,
      state,
      bytes,
      total,
      ...(error !== undefined ? { error } : {}),
      ...(folder ? { folder: true } : {}),
      ...(job.parentId !== undefined ? { parentId: job.parentId } : {}),
    };
  }
}

const RESERVE_SEPARATOR = '\u0000';

function splitReserveKey(key: string): [string, string] {
  const index = key.lastIndexOf(RESERVE_SEPARATOR);
  return [key.slice(0, index), key.slice(index + 1)];
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'failure';
}
