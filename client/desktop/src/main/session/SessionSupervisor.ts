import {
  ReconnectScheduler,
  type AuthMethod,
  type Clock,
  type Disposable,
  type ReconnectPolicy,
  type ResourceTracker,
  type SessionState,
  type SshErrorCode,
} from '@btterm/core';

/** session host에 넘길 접속 파라미터. 인증 정보는 main 메모리에만 머문다(SEC-1). */
export interface SessionParams {
  host: string;
  port: number;
  username: string;
  keepaliveSec: number;
  auth: AuthMethod[];
  /** 연결 직후 명령(F6.11). 한 줄이 아니면 보내지 않는다 */
  startupCommand?: string;
}

export interface EmitExtra {
  errorCode?: SshErrorCode;
  reconnect?: { attempt: number; nextDelayMs: number | null };
}

interface SupervisorDeps {
  clock: Clock;
  tracker: ResourceTracker;
  policy: ReconnectPolicy;
  /** session host에 open을 보낸다(같은 sessionId로 새 포트). */
  start(sessionId: string, params: SessionParams): void;
  emit(sessionId: string, state: SessionState, extra?: EmitExtra): void;
  /** 끝난 세션을 수동으로 다시 열 때 인증 정보를 다시 받는다(취소하면 null) */
  refreshAuth?(sessionId: string): Promise<AuthMethod[] | null>;
}

interface SessionRecord {
  params: SessionParams;
  state: SessionState;
  userClosed: boolean;
  interactive: boolean;
  scheduler: ReconnectScheduler | null;
  waiter: ((ok: boolean) => void) | null;
  lastError: SshErrorCode | undefined;
}

/**
 * 세션 기록과 자동 재접속(F2.5, AC12). 연결이 끊기면 정책에 따라 같은 sessionId로 다시 시작한다.
 * 인증 실패·호스트 키 거부·대화형 인증(2FA)·사용자가 닫은 세션은 자동 재접속하지 않는다.
 */
export class SessionSupervisor implements Disposable {
  readonly #deps: SupervisorDeps;
  readonly #records = new Map<string, SessionRecord>();

  constructor(deps: SupervisorDeps) {
    this.#deps = deps;
  }

  open(sessionId: string, params: SessionParams): void {
    this.#records.set(sessionId, {
      params,
      state: 'connecting',
      userClosed: false,
      interactive: false,
      scheduler: null,
      waiter: null,
      lastError: undefined,
    });
    this.#deps.start(sessionId, params);
  }

  markInteractive(sessionId: string): void {
    const record = this.#records.get(sessionId);
    if (record) record.interactive = true;
  }

  onState(sessionId: string, state: SessionState, errorCode?: SshErrorCode): void {
    const record = this.#records.get(sessionId);
    if (!record) {
      this.#deps.emit(sessionId, state, errorCode ? { errorCode } : undefined);
      return;
    }
    record.state = state;

    if (record.waiter) {
      // 재접속 시도 중: 결과만 스케줄러에 알리고 중간 상태는 reconnecting으로 보인다.
      if (state === 'ready') {
        this.#settle(record, true);
        this.#deps.emit(sessionId, 'ready');
      } else if (state === 'failed' || state === 'closed') {
        record.lastError = errorCode;
        this.#settle(record, false);
      }
      return;
    }

    const retryable =
      state === 'failed' &&
      !record.userClosed &&
      errorCode !== undefined &&
      this.#deps.policy.shouldRetry(errorCode, record.interactive);
    if (retryable && !record.scheduler) {
      this.#startReconnect(sessionId, record, errorCode);
      return;
    }

    this.#deps.emit(sessionId, state, errorCode ? { errorCode } : undefined);
    if (state === 'closed' || state === 'failed') this.#dropSecrets(record);
    if ((state === 'closed' || state === 'failed') && record.userClosed) {
      this.#forget(sessionId, record);
    }
  }

  close(sessionId: string): void {
    const record = this.#records.get(sessionId);
    if (!record) return;
    if (record.state === 'closed' || record.state === 'failed') {
      // 이미 끝났으면 host가 더 알려줄 상태가 없다.
      this.#forget(sessionId, record);
      return;
    }
    record.userClosed = true;
    record.scheduler?.dispose();
    record.scheduler = null;
    this.#settle(record, false);
  }

  forget(sessionId: string): void {
    const record = this.#records.get(sessionId);
    if (record) this.#forget(sessionId, record);
  }

  has(sessionId: string): boolean {
    return this.#records.has(sessionId);
  }

  paramsOf(sessionId: string): SessionParams | undefined {
    return this.#records.get(sessionId)?.params;
  }

  async reconnectNow(sessionId: string): Promise<void> {
    const record = this.#records.get(sessionId);
    if (!record) return;
    record.scheduler?.dispose();
    record.scheduler = null;
    if (record.params.auth.length === 0 && this.#deps.refreshAuth) {
      const auth = await this.#deps.refreshAuth(sessionId);
      if (auth === null || this.#records.get(sessionId) !== record) return;
      record.params = { ...record.params, auth };
    }
    record.userClosed = false;
    record.state = 'connecting';
    this.#deps.start(sessionId, record.params);
  }

  readySessions(): string[] {
    return [...this.#records].filter(([, r]) => r.state === 'ready').map(([id]) => id);
  }

  dispose(): void {
    for (const [id, record] of this.#records) this.#forget(id, record);
  }

  #startReconnect(sessionId: string, record: SessionRecord, errorCode: SshErrorCode): void {
    record.lastError = errorCode;
    const scheduler = new ReconnectScheduler({
      policy: this.#deps.policy,
      clock: this.#deps.clock,
      tracker: this.#deps.tracker,
      attempt: () =>
        new Promise<boolean>((resolve) => {
          record.waiter = resolve;
          this.#deps.start(sessionId, record.params);
        }),
      onStatus: (status) => {
        if (status.state === 'waiting') {
          this.#deps.emit(sessionId, 'reconnecting', {
            reconnect: { attempt: status.attempt, nextDelayMs: status.nextDelayMs },
          });
        } else if (status.state === 'gave-up') {
          this.#deps.emit(
            sessionId,
            'failed',
            record.lastError ? { errorCode: record.lastError } : undefined,
          );
          this.#dropScheduler(record, scheduler);
          this.#dropSecrets(record);
        } else if (status.state === 'succeeded') {
          this.#dropScheduler(record, scheduler);
        }
      },
    });
    record.scheduler = scheduler;
    scheduler.start();
  }

  /** 더 쓰지 않을 비밀은 메모리에서 지운다. 수동 재접속 때 refreshAuth로 다시 받는다(보안 리뷰 #7). */
  #dropSecrets(record: SessionRecord): void {
    record.params = { ...record.params, auth: [] };
  }

  #dropScheduler(record: SessionRecord, scheduler: ReconnectScheduler): void {
    if (record.scheduler === scheduler) record.scheduler = null;
    scheduler.dispose();
  }

  #settle(record: SessionRecord, ok: boolean): void {
    const waiter = record.waiter;
    record.waiter = null;
    waiter?.(ok);
  }

  #forget(sessionId: string, record: SessionRecord): void {
    record.scheduler?.dispose();
    record.scheduler = null;
    this.#settle(record, false);
    this.#records.delete(sessionId);
  }
}
