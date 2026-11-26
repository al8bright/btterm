import { AckFlowController } from '../terminal/AckFlowController';
import { OutputCoalescer } from '../terminal/OutputCoalescer';
import {
  RendererToHostFrameSchema,
  type HistoryResult,
  type HostToRendererFrame,
  type StatsResult,
  type SessionState,
} from '../ipc/contracts';
import { historyFromFile } from '../history/shellHistory';
import {
  STATS_MAX_BYTES,
  STATS_SCRIPT,
  computeStats,
  isEmptySample,
  parseStatsOutput,
  type StatsSample,
} from '../stats/serverStats';
import { SftpError, type SftpSession } from '../sftp/SftpSession';
import type { Clock } from '../time/Clock';
import type { Disposable, ResourceTracker } from '../resource/ResourceTracker';
import {
  SshError,
  type AuthMethod,
  type ByteDuplex,
  type KeyboardInteractiveRequest,
  type PresentedHostKey,
  type PtySize,
  type SshConnection,
  type SshErrorCode,
  type SshTransport,
} from '../ssh/SshTransport';

const HISTORY_FILES = [
  ['.bash_history', 'bash'],
  ['.zsh_history', 'zsh'],
] as const;
/** 기록 파일은 끝 2MB만 읽는다(F3.17a). */
const HISTORY_MAX_BYTES = 2 * 1024 * 1024;

/** renderer와 직결된 MessagePort의 추상화. 들어오는 프레임은 검증 전 원본(unknown)이다. */
export interface FramePort {
  post(frame: HostToRendererFrame): void;
  onFrame(listener: (raw: unknown) => void): Disposable;
  close(): void;
}

export interface HostSessionDeps {
  transport: SshTransport;
  clock: Clock;
  tracker: ResourceTracker;
  port: FramePort;
  reportState(state: SessionState, errorCode?: SshErrorCode): void;
  verifyHostKey(key: PresentedHostKey): Promise<boolean>;
  /** 있으면 keyboard-interactive(OTP 등)를 사용자에게 묻는다. */
  keyboardInteractive?(request: KeyboardInteractiveRequest): Promise<string[]>;
  flow?: { highWaterMark: number; lowWaterMark: number };
}

export interface OpenRequest {
  host: string;
  port: number;
  username: string;
  keepaliveSec: number;
  auth: AuthMethod[];
  size: PtySize;
  /** 셸이 준비되면 한 번 입력 + Enter(F6.11). 재접속도 새 셸이라 다시 보낸다 */
  startupCommand?: string | undefined;
}

const DEFAULT_FLOW = { highWaterMark: 32 * 1024, lowWaterMark: 8 * 1024 };
/** 서버 상태 스크립트 한 회차의 시간 상한(ST5) */
const STATS_TIMEOUT_MS = 5000;
/** 이 간격 안의 요청은 직전 결과로 답한다(보안 리뷰 #6) */
const STATS_MIN_INTERVAL_MS = 2000;
/** 실패·빈 출력이 이만큼 이어지면 그 세션은 수집을 멈춘다(보안 리뷰 #2) */
const STATS_MAX_FAILURES = 3;

/**
 * session host 안에서 SSH 세션 하나의 수명을 관리한다.
 * SSH 셸 ↔ (병합·흐름 제어) ↔ renderer 포트. 모든 경계 프레임은 스키마로 검증한다(AGENTS §3).
 */
export class HostSession {
  readonly #deps: HostSessionDeps;
  readonly #handle: Disposable;
  readonly #subscriptions: Disposable[] = [];
  #coalescer: OutputCoalescer | null = null;
  #connection: SshConnection | null = null;
  #shell: ByteDuplex | null = null;
  #finished = false;
  /** 직전 상태 표본(CPU%·네트워크 속도 계산용, F3.18). 메모리에만 둔다(ST7). */
  #lastStats: { sample: StatsSample; at: number } | null = null;
  #statsInFlight: Promise<StatsResult> | null = null;
  #statsLast: { result: StatsResult; at: number } | null = null;
  #statsFailures = 0;

  constructor(deps: HostSessionDeps) {
    this.#deps = deps;
    this.#handle = deps.tracker.track('host-session');
  }

  async open(request: OpenRequest): Promise<void> {
    const { reportState, transport } = this.#deps;
    reportState('connecting');
    try {
      this.#connection = await transport.connect(
        {
          host: request.host,
          port: request.port,
          username: request.username,
          keepaliveSec: request.keepaliveSec,
        },
        request.auth,
        {
          verifyHostKey: async (key) => {
            const ok = await this.#deps.verifyHostKey(key);
            if (ok) reportState('authenticating');
            return ok;
          },
          ...(this.#deps.keyboardInteractive
            ? { keyboardInteractive: this.#deps.keyboardInteractive }
            : {}),
        },
      );
      // 사용자가 확인창에 답하는 사이 세션을 닫았으면 늦게 성립한 연결을 남기지 않는다(보안 리뷰)
      if (this.#finished) {
        this.#connection.end();
        return;
      }
      this.#subscriptions.push(
        this.#connection.onClose((error) => this.#finish(error ? 'failed' : 'closed', error?.code)),
      );
      this.#shell = await this.#connection.openShell(request.size);
    } catch (error) {
      this.#finish('failed', error instanceof SshError ? error.code : 'unknown');
      return;
    }
    if (this.#finished) return;
    this.#wireShell(this.#shell);
    reportState('ready');
    if (request.startupCommand) this.#shell.write(`${request.startupCommand}\r`);
  }

  close(): void {
    this.#finish('closed', undefined);
  }

  /** 절전 복귀 등에서 연결 생존을 확인한다. 죽었으면 failed(closed)로 끝내 재접속을 유도한다(F6.6). */
  async probe(timeoutMs: number): Promise<boolean> {
    const connection = this.#connection;
    if (!connection || this.#finished) return false;
    const alive = await connection.probe(timeoutMs);
    if (!alive) this.#finish('failed', 'closed');
    return alive;
  }

  /** 같은 연결에 SFTP 채널을 연다(F4.1). 연결 전·종료 후에는 실패한다. */
  async openSftp(): Promise<SftpSession> {
    const connection = this.#connection;
    if (!connection || this.#finished) throw new SftpError('failure', '연결되지 않음');
    return connection.openSftp();
  }

  /** 원격 셸 기록을 읽는다(F3.17a). bash가 없으면 zsh. 비밀은 여기서 가린 뒤 내보낸다. */
  async readHistory(): Promise<HistoryResult> {
    const connection = this.#connection;
    if (!connection || this.#finished) return { status: 'unavailable', entries: [] };
    let status: HistoryResult['status'] = 'missing';
    for (const [path, kind] of HISTORY_FILES) {
      const file = await connection.readFileTail(path, HISTORY_MAX_BYTES);
      if (file.status === 'ok') {
        return { status: 'ok', entries: historyFromFile(kind, file.bytes, file.truncated) };
      }
      if (status === 'missing') status = file.status;
    }
    return { status, entries: [] };
  }

  /** 서버 상태 줄(F3.18): 고정 스크립트를 exec로 돌려 해석한다. 직전 표본과의 차이로 속도를 낸다. */
  readStats(): Promise<StatsResult> {
    if (this.#statsFailures >= STATS_MAX_FAILURES)
      return Promise.resolve({ status: 'unavailable' });
    const last = this.#statsLast;
    if (last && this.#deps.clock.now() - last.at < STATS_MIN_INTERVAL_MS) {
      return Promise.resolve(last.result);
    }
    // 겹친 요청은 진행 중인 회차를 같이 기다린다(ST2: 세션당 하나).
    this.#statsInFlight ??= this.#sampleStats()
      .then((result) => {
        this.#statsFailures = result.status === 'ok' ? 0 : this.#statsFailures + 1;
        this.#statsLast = { result, at: this.#deps.clock.now() };
        return result;
      })
      .finally(() => (this.#statsInFlight = null));
    return this.#statsInFlight;
  }

  async #sampleStats(): Promise<StatsResult> {
    const connection = this.#connection;
    if (!connection || this.#finished) return { status: 'unavailable' };
    const output = await connection.execCapture(STATS_SCRIPT, STATS_MAX_BYTES, STATS_TIMEOUT_MS);
    if (!output || this.#finished) return { status: 'unavailable' };
    const sample = parseStatsOutput(new TextDecoder().decode(output));
    if (isEmptySample(sample)) return { status: 'unavailable' };
    const at = this.#deps.clock.now();
    const stats = computeStats(this.#lastStats, sample, at);
    this.#lastStats = { sample, at };
    return { status: 'ok', stats };
  }

  #wireShell(shell: ByteDuplex): void {
    const { port, clock, tracker } = this.#deps;
    const flow = new AckFlowController({
      ...(this.#deps.flow ?? DEFAULT_FLOW),
      pause: () => shell.pause(),
      resume: () => shell.resume(),
    });
    this.#coalescer = new OutputCoalescer({
      clock,
      tracker,
      onFlush: (chunk) => {
        port.post({ t: 'data', data: chunk });
        flow.onSent(chunk.length);
      },
    });
    const coalescer = this.#coalescer;
    this.#subscriptions.push(
      shell.onData((chunk) => coalescer.push(chunk)),
      // 셸이 먼저 닫히면 연결을 끝내고, 상태 보고는 연결 종료 이벤트가 맡는다.
      shell.onClose(() => this.#connection?.end()),
      port.onFrame((raw) => {
        const parsed = RendererToHostFrameSchema.safeParse(raw);
        if (!parsed.success) return;
        const frame = parsed.data;
        if (frame.t === 'input') shell.write(frame.data);
        else if (frame.t === 'resize') shell.resize({ cols: frame.cols, rows: frame.rows });
        else this.#ack(flow, frame.bytes);
      }),
    );
  }

  #ack(flow: AckFlowController, bytes: number): void {
    try {
      flow.onAck(bytes);
    } catch {
      // ACK 단위가 어긋난 renderer 버그. 세션을 지키기 위해 무시한다(로그는 호출자 책임).
    }
  }

  #finish(state: 'closed' | 'failed', errorCode: SshErrorCode | undefined): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#deps.reportState(state, errorCode);
    this.#coalescer?.flush();
    this.#deps.port.post({ t: 'exit' });
    for (const sub of this.#subscriptions.splice(0)) sub.dispose();
    this.#coalescer?.dispose();
    this.#shell?.close();
    this.#connection?.end();
    this.#deps.port.close();
    this.#handle.dispose();
  }
}
