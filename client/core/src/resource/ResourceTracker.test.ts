import { describe, expect, it } from 'vitest';
import { ResourceTracker } from './ResourceTracker';

describe('ResourceTracker', () => {
  it('추적 중인 자원이 없으면 assertAllDisposed가 통과한다', () => {
    const tracker = new ResourceTracker();
    expect(() => tracker.assertAllDisposed()).not.toThrow();
  });

  it('dispose하지 않은 자원이 있으면 라벨을 담아 실패한다', () => {
    const tracker = new ResourceTracker();
    tracker.track('ssh-channel#1');
    tracker.track('timer:keepalive');
    expect(() => tracker.assertAllDisposed()).toThrow(/ssh-channel#1.*timer:keepalive/s);
  });

  it('dispose한 자원은 더 이상 추적하지 않는다', () => {
    const tracker = new ResourceTracker();
    tracker.track('a').dispose();
    expect(tracker.liveCount).toBe(0);
    expect(() => tracker.assertAllDisposed()).not.toThrow();
  });

  it('cleanup은 dispose를 여러 번 호출해도 한 번만 실행된다', () => {
    const tracker = new ResourceTracker();
    let calls = 0;
    const handle = tracker.track('a', () => {
      calls += 1;
    });
    handle.dispose();
    handle.dispose();
    expect(calls).toBe(1);
  });
});
