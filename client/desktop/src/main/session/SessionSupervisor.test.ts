import { describe, expect, it } from 'vitest';
import { ReconnectPolicy, type SessionState } from '@btterm/core';
import { FakeClock, newTestTracker } from '@btterm/core/testing';
import { SessionSupervisor, type SessionParams } from './SessionSupervisor';

const params: SessionParams = {
  host: 'h',
  port: 22,
  username: 'u',
  keepaliveSec: 30,
  auth: [{ kind: 'password', password: 'pw' }],
};

function setup() {
  const clock = new FakeClock();
  const starts: string[] = [];
  const emitted: Array<{ state: SessionState; errorCode?: string; attempt?: number }> = [];
  const supervisor = new SessionSupervisor({
    clock,
    tracker: newTestTracker(),
    policy: new ReconnectPolicy(),
    start: (sessionId) => starts.push(sessionId),
    emit: (_sessionId, state, extra) =>
      emitted.push({
        state,
        ...(extra?.errorCode ? { errorCode: extra.errorCode } : {}),
        ...(extra?.reconnect ? { attempt: extra.reconnect.attempt } : {}),
      }),
  });
  return { clock, starts, emitted, supervisor };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('SessionSupervisor', () => {
  it('open하면 세션을 시작하고 host 상태를 그대로 전달한다', () => {
    const { starts, emitted, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.onState('s1', 'ready');
    expect(starts).toEqual(['s1']);
    expect(emitted.at(-1)).toEqual({ state: 'ready' });
    supervisor.dispose();
  });

  it('AC12 연결이 끊기면(closed) 백오프 후 다시 시작하고, 성공하면 ready', async () => {
    const { clock, starts, emitted, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.onState('s1', 'ready');
    supervisor.onState('s1', 'failed', 'closed');
    expect(emitted.at(-1)).toEqual({ state: 'reconnecting', attempt: 1 });
    clock.advance(1000);
    expect(starts).toEqual(['s1', 's1']);
    supervisor.onState('s1', 'ready');
    await flush();
    expect(emitted.at(-1)).toEqual({ state: 'ready' });
    supervisor.dispose();
  });

  it('AC12 재시도가 모두 실패하면 failed로 끝난다', async () => {
    const { clock, starts, emitted, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.onState('s1', 'failed', 'refused');
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      clock.advance(delay);
      supervisor.onState('s1', 'failed', 'refused');
      await flush();
    }
    expect(starts).toHaveLength(6);
    expect(emitted.at(-1)).toEqual({ state: 'failed', errorCode: 'refused' });
    supervisor.dispose();
  });

  it('인증 실패·호스트 키 거부는 재접속하지 않는다', () => {
    const { clock, starts, emitted, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.onState('s1', 'failed', 'auth-failed');
    clock.advance(60_000);
    expect(starts).toEqual(['s1']);
    expect(emitted.at(-1)).toEqual({ state: 'failed', errorCode: 'auth-failed' });
    supervisor.dispose();
  });

  it('keyboard-interactive 세션은 자동 재접속하지 않는다(2FA)', () => {
    const { clock, starts, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.markInteractive('s1');
    supervisor.onState('s1', 'failed', 'closed');
    clock.advance(60_000);
    expect(starts).toEqual(['s1']);
    supervisor.dispose();
  });

  it('사용자가 닫은 세션은 재접속하지 않는다', () => {
    const { clock, starts, emitted, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.close('s1');
    supervisor.onState('s1', 'closed');
    clock.advance(60_000);
    expect(starts).toEqual(['s1']);
    expect(emitted.at(-1)).toEqual({ state: 'closed' });
    supervisor.dispose();
  });

  it('수동 재접속은 즉시 다시 시작한다', () => {
    const { starts, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.onState('s1', 'failed', 'auth-failed');
    supervisor.reconnectNow('s1');
    expect(starts).toEqual(['s1', 's1']);
    supervisor.dispose();
  });

  it('이미 끝난 세션을 닫으면 기록을 지운다', () => {
    const { supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.onState('s1', 'closed');
    expect(supervisor.has('s1')).toBe(true); // 수동 재접속을 위해 남긴다
    expect(supervisor.paramsOf('s1')).toEqual({ ...params, auth: [] }); // 비밀은 지운다
    supervisor.close('s1');
    expect(supervisor.has('s1')).toBe(false);
  });

  it('forget은 재접속 대기까지 정리한다', () => {
    const { clock, starts, supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.onState('s1', 'failed', 'closed');
    supervisor.forget('s1');
    clock.advance(60_000);
    expect(starts).toEqual(['s1']);
    expect(supervisor.has('s1')).toBe(false);
  });

  it('ready 상태의 세션 목록을 알려준다(절전 복귀 점검용)', () => {
    const { supervisor } = setup();
    supervisor.open('s1', params);
    supervisor.open('s2', params);
    supervisor.onState('s1', 'ready');
    expect(supervisor.readySessions()).toEqual(['s1']);
    supervisor.dispose();
  });
});

describe('SessionSupervisor 비밀 수명(보안 리뷰 #7)', () => {
  function withRefresh(refreshed: SessionParams['auth'] | null) {
    const env = setup();
    const started: SessionParams[] = [];
    const refreshCalls: string[] = [];
    const supervisor = new SessionSupervisor({
      clock: env.clock,
      tracker: newTestTracker(),
      policy: new ReconnectPolicy(),
      start: (_id, p) => started.push(p),
      emit: () => undefined,
      refreshAuth: async (id) => {
        refreshCalls.push(id);
        return refreshed;
      },
    });
    return { supervisor, started, refreshCalls };
  }

  it('끝난 세션(재시도 안 함)은 인증 정보를 지우고, 수동 재접속 때 다시 받는다', async () => {
    const { supervisor, started, refreshCalls } = withRefresh([
      { kind: 'password', password: 'new' },
    ]);
    supervisor.open('s1', params);
    supervisor.onState('s1', 'failed', 'auth-failed');
    expect(supervisor.paramsOf('s1')?.auth).toEqual([]);
    await supervisor.reconnectNow('s1');
    expect(refreshCalls).toEqual(['s1']);
    expect(started.at(-1)?.auth).toEqual([{ kind: 'password', password: 'new' }]);
    supervisor.dispose();
  });

  it('다시 받기를 취소하면 시작하지 않는다', async () => {
    const { supervisor, started } = withRefresh(null);
    supervisor.open('s1', params);
    supervisor.onState('s1', 'closed');
    await supervisor.reconnectNow('s1');
    expect(started).toHaveLength(1);
    supervisor.dispose();
  });

  it('연결 중·자동 재접속 대기 중에는 인증 정보를 유지한다', () => {
    const { supervisor } = withRefresh(null);
    supervisor.open('s1', params);
    supervisor.onState('s1', 'ready');
    expect(supervisor.paramsOf('s1')?.auth).toEqual(params.auth);
    supervisor.onState('s1', 'failed', 'closed');
    expect(supervisor.paramsOf('s1')?.auth).toEqual(params.auth);
    supervisor.dispose();
  });
});
