import { describe, expect, it } from 'vitest';
import { ReconnectPolicy, ReconnectScheduler } from './ReconnectPolicy';
import type { ReconnectSchedulerOptions } from './ReconnectPolicy';
import { FakeClock } from '../time/FakeClock';
import { newTestTracker } from '../testing/trackers';

type Status = Parameters<NonNullable<ReconnectSchedulerOptions['onStatus']>>[0];

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(results: (boolean | 'throw')[], policy = new ReconnectPolicy()) {
  const clock = new FakeClock();
  const statuses: Status[] = [];
  let calls = 0;
  const scheduler = new ReconnectScheduler({
    policy,
    clock,
    tracker: newTestTracker(),
    attempt: () => {
      const r = results[calls++] ?? false;
      return r === 'throw' ? Promise.reject(new Error('boom')) : Promise.resolve(r);
    },
    onStatus: (s) => statuses.push(s),
  });
  return { clock, statuses, scheduler, calls: () => calls };
}

describe('ReconnectPolicy', () => {
  it('지연은 1s부터 두 배씩 늘어난다', () => {
    const p = new ReconnectPolicy();
    expect([1, 2, 3, 4, 5].map((n) => p.delayFor(n))).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it('지연은 maxDelayMs를 넘지 않는다', () => {
    const p = new ReconnectPolicy({ maxAttempts: 10, maxDelayMs: 5000 });
    expect(p.delayFor(4)).toBe(5000);
    expect(p.delayFor(10)).toBe(5000);
  });

  it('maxAttempts를 넘으면 null이다', () => {
    const p = new ReconnectPolicy({ maxAttempts: 2 });
    expect(p.delayFor(2)).toBe(2000);
    expect(p.delayFor(3)).toBeNull();
  });

  it('attempt가 1 미만이면 null이다', () => {
    expect(new ReconnectPolicy().delayFor(0)).toBeNull();
  });

  it('closed·timeout·refused·dns·unknown은 재시도한다', () => {
    const p = new ReconnectPolicy();
    for (const code of ['closed', 'timeout', 'refused', 'dns', 'unknown'] as const) {
      expect(p.shouldRetry(code, false)).toBe(true);
    }
  });

  it('auth-failed·host-key-rejected는 재시도하지 않는다', () => {
    const p = new ReconnectPolicy();
    expect(p.shouldRetry('auth-failed', false)).toBe(false);
    expect(p.shouldRetry('host-key-rejected', false)).toBe(false);
  });

  it('AC12: 2FA·대화형 인증이면 오류 종류와 무관하게 자동 재접속하지 않는다', () => {
    const p = new ReconnectPolicy();
    expect(p.shouldRetry('closed', true)).toBe(false);
    expect(p.shouldRetry('timeout', true)).toBe(false);
  });
});

describe('ReconnectScheduler', () => {
  it('AC12: start하면 waiting을 보고하고 1초 뒤 첫 시도를 한다', async () => {
    const { clock, statuses, scheduler, calls } = setup([true]);
    scheduler.start();
    expect(statuses).toEqual([{ attempt: 1, nextDelayMs: 1000, state: 'waiting' }]);
    clock.advance(999);
    expect(calls()).toBe(0);
    clock.advance(1);
    expect(calls()).toBe(1);
    expect(statuses.at(-1)).toEqual({ attempt: 1, nextDelayMs: null, state: 'trying' });
    await flush();
    expect(statuses.at(-1)).toEqual({ attempt: 1, nextDelayMs: null, state: 'succeeded' });
    expect(clock.pendingCount).toBe(0);
    scheduler.dispose();
  });

  it('AC12: 실패하면 지수 백오프로 다음 시도를 하고 성공하면 멈춘다', async () => {
    const { clock, statuses, scheduler, calls } = setup([false, false, true]);
    scheduler.start();
    clock.advance(1000);
    await flush();
    expect(statuses.at(-1)).toEqual({ attempt: 2, nextDelayMs: 2000, state: 'waiting' });
    clock.advance(2000);
    await flush();
    expect(statuses.at(-1)).toEqual({ attempt: 3, nextDelayMs: 4000, state: 'waiting' });
    clock.advance(4000);
    await flush();
    expect(calls()).toBe(3);
    expect(statuses.at(-1)?.state).toBe('succeeded');
    clock.advance(60000);
    expect(calls()).toBe(3);
    scheduler.dispose();
  });

  it('AC12: 모든 시도가 실패하면 gave-up을 보고한다', async () => {
    const { clock, statuses, scheduler, calls } = setup(
      [],
      new ReconnectPolicy({ maxAttempts: 2 }),
    );
    scheduler.start();
    clock.advance(1000);
    await flush();
    clock.advance(2000);
    await flush();
    expect(calls()).toBe(2);
    expect(statuses.at(-1)).toEqual({ attempt: 2, nextDelayMs: null, state: 'gave-up' });
    expect(clock.pendingCount).toBe(0);
    scheduler.dispose();
  });

  it('attempt가 reject되면 실패로 취급한다', async () => {
    const { clock, statuses, scheduler } = setup(['throw', true]);
    scheduler.start();
    clock.advance(1000);
    await flush();
    expect(statuses.at(-1)).toEqual({ attempt: 2, nextDelayMs: 2000, state: 'waiting' });
    scheduler.dispose();
  });

  it('cancel하면 대기 타이머를 지우고 cancelled를 보고한다', () => {
    const { clock, statuses, scheduler, calls } = setup([true]);
    scheduler.start();
    scheduler.cancel();
    expect(clock.pendingCount).toBe(0);
    expect(statuses.at(-1)).toEqual({ attempt: 1, nextDelayMs: null, state: 'cancelled' });
    clock.advance(10000);
    expect(calls()).toBe(0);
    scheduler.dispose();
  });

  it('시도 중 cancel하면 결과가 와도 더 진행하지 않는다', async () => {
    const { clock, statuses, scheduler, calls } = setup([false]);
    scheduler.start();
    clock.advance(1000);
    scheduler.cancel();
    await flush();
    expect(statuses.at(-1)?.state).toBe('cancelled');
    expect(clock.pendingCount).toBe(0);
    expect(calls()).toBe(1);
    scheduler.dispose();
  });

  it('start를 두 번 호출해도 한 번만 시작한다', () => {
    const { clock, scheduler } = setup([true]);
    scheduler.start();
    scheduler.start();
    expect(clock.pendingCount).toBe(1);
    scheduler.dispose();
  });

  it('dispose하면 타이머가 정리되고 tracker에서 해제된다', () => {
    const tracker = newTestTracker();
    const clock = new FakeClock();
    const scheduler = new ReconnectScheduler({
      policy: new ReconnectPolicy(),
      clock,
      tracker,
      attempt: () => Promise.resolve(true),
    });
    expect(tracker.liveCount).toBe(1);
    scheduler.start();
    scheduler.dispose();
    expect(clock.pendingCount).toBe(0);
    expect(tracker.liveCount).toBe(0);
  });
});
