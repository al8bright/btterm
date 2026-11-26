import type { Cancel, Clock } from '../time/Clock';
import type { Disposable, ResourceTracker } from '../resource/ResourceTracker';
import type { SshErrorCode } from '../ssh/SshTransport';

export interface ReconnectPolicyOptions {
  /** 기본 5회. */
  maxAttempts?: number;
  /** 첫 지연. 기본 1000ms. */
  baseDelayMs?: number;
  /** 지연 상한. 기본 30000ms. */
  maxDelayMs?: number;
}

const NON_RETRYABLE: readonly SshErrorCode[] = ['auth-failed', 'host-key-rejected'];

/** 자동 재접속 지수 백오프와 대상 판정(F2.5, AC12). */
export class ReconnectPolicy {
  readonly #maxAttempts: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;

  constructor(options: ReconnectPolicyOptions = {}) {
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#baseDelayMs = options.baseDelayMs ?? 1000;
    this.#maxDelayMs = options.maxDelayMs ?? 30000;
  }

  /** attempt는 1부터. 범위를 벗어나면 null. */
  delayFor(attempt: number): number | null {
    if (attempt < 1 || attempt > this.#maxAttempts) return null;
    return Math.min(this.#baseDelayMs * 2 ** (attempt - 1), this.#maxDelayMs);
  }

  shouldRetry(errorCode: SshErrorCode, interactiveAuth: boolean): boolean {
    return !interactiveAuth && !NON_RETRYABLE.includes(errorCode);
  }
}

export type ReconnectState = 'waiting' | 'trying' | 'succeeded' | 'gave-up' | 'cancelled';

export interface ReconnectStatus {
  attempt: number;
  nextDelayMs: number | null;
  state: ReconnectState;
}

export interface ReconnectSchedulerOptions {
  policy: ReconnectPolicy;
  clock: Clock;
  tracker: ResourceTracker;
  /** 재접속 시도. 성공하면 true. reject는 실패로 본다. */
  attempt: () => Promise<boolean>;
  onStatus?: (s: ReconnectStatus) => void;
}

/** 정책에 따라 재접속을 예약·시도한다. */
export class ReconnectScheduler implements Disposable {
  readonly #options: ReconnectSchedulerOptions;
  readonly #handle: Disposable;
  #cancelTimer: Cancel | null = null;
  #started = false;
  #finished = false;
  #attempt = 0;

  constructor(options: ReconnectSchedulerOptions) {
    this.#options = options;
    this.#handle = options.tracker.track('reconnect-scheduler', () => this.#clearTimer());
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#schedule(1);
  }

  cancel(): void {
    if (!this.#started || this.#finished) return;
    this.#clearTimer();
    this.#finish('cancelled');
  }

  dispose(): void {
    this.cancel();
    this.#handle.dispose();
  }

  #schedule(attempt: number): void {
    const delay = this.#options.policy.delayFor(attempt);
    if (delay === null) {
      this.#finish('gave-up');
      return;
    }
    this.#attempt = attempt;
    this.#report('waiting', delay);
    this.#cancelTimer = this.#options.clock.setTimeout(() => {
      this.#cancelTimer = null;
      void this.#run(attempt);
    }, delay);
  }

  async #run(attempt: number): Promise<void> {
    this.#report('trying', null);
    const ok = await this.#options.attempt().catch(() => false);
    if (this.#finished) return;
    if (ok) this.#finish('succeeded');
    else this.#schedule(attempt + 1);
  }

  #finish(state: ReconnectState): void {
    this.#finished = true;
    this.#report(state, null);
  }

  #report(state: ReconnectState, nextDelayMs: number | null): void {
    this.#options.onStatus?.({ attempt: this.#attempt, nextDelayMs, state });
  }

  #clearTimer(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }
}
