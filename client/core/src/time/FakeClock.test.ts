import { describe, expect, it } from 'vitest';
import { FakeClock } from './FakeClock';

describe('FakeClock', () => {
  it('지정한 시각에서 시작한다', () => {
    expect(new FakeClock(1000).now()).toBe(1000);
  });

  it('advance 전에는 타이머가 실행되지 않는다', () => {
    const clock = new FakeClock();
    let fired = false;
    clock.setTimeout(() => {
      fired = true;
    }, 10);
    expect(fired).toBe(false);
  });

  it('advance로 만기된 타이머를 만기 순서대로 실행하고 시각을 옮긴다', () => {
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimeout(() => order.push(`b@${clock.now()}`), 20);
    clock.setTimeout(() => order.push(`a@${clock.now()}`), 10);
    clock.advance(25);
    expect(order).toEqual(['a@10', 'b@20']);
    expect(clock.now()).toBe(25);
  });

  it('취소한 타이머는 실행되지 않는다', () => {
    const clock = new FakeClock();
    let fired = false;
    const cancel = clock.setTimeout(() => {
      fired = true;
    }, 5);
    cancel();
    clock.advance(10);
    expect(fired).toBe(false);
  });

  it('타이머 안에서 등록한 타이머도 같은 advance 범위 안이면 실행된다', () => {
    const clock = new FakeClock(0);
    const hits: number[] = [];
    clock.setTimeout(() => {
      hits.push(clock.now());
      clock.setTimeout(() => hits.push(clock.now()), 5);
    }, 5);
    clock.advance(10);
    expect(hits).toEqual([5, 10]);
  });

  it('대기 중인 타이머 수를 알려준다', () => {
    const clock = new FakeClock();
    const cancel = clock.setTimeout(() => undefined, 5);
    expect(clock.pendingCount).toBe(1);
    cancel();
    expect(clock.pendingCount).toBe(0);
  });
});
