import { describe, expect, it } from 'vitest';
import { OutputCoalescer } from './OutputCoalescer';
import { FakeClock } from '../time/FakeClock';
import { newTestTracker } from '../testing/trackers';

function setup(maxBytes = 8, maxDelayMs = 16) {
  const clock = new FakeClock();
  const flushed: string[] = [];
  const coalescer = new OutputCoalescer({
    clock,
    tracker: newTestTracker(),
    maxBytes,
    maxDelayMs,
    onFlush: (chunk) => flushed.push(new TextDecoder().decode(chunk)),
  });
  return { clock, flushed, coalescer };
}

const b = (s: string) => new TextEncoder().encode(s);

describe('OutputCoalescer', () => {
  it('maxBytes 미만이고 지연 시간 전이면 내보내지 않는다', () => {
    const { clock, flushed, coalescer } = setup();
    coalescer.push(b('abc'));
    clock.advance(15);
    expect(flushed).toEqual([]);
    coalescer.dispose();
  });

  it('첫 청크 후 maxDelayMs가 지나면 모은 것을 한 번에 내보낸다', () => {
    const { clock, flushed, coalescer } = setup();
    coalescer.push(b('ab'));
    clock.advance(5);
    coalescer.push(b('cd'));
    clock.advance(11);
    expect(flushed).toEqual(['abcd']);
    coalescer.dispose();
  });

  it('maxBytes에 도달하면 즉시 내보내고 타이머를 취소한다', () => {
    const { clock, flushed, coalescer } = setup(4);
    coalescer.push(b('ab'));
    coalescer.push(b('cdef'));
    expect(flushed).toEqual(['abcdef']);
    expect(clock.pendingCount).toBe(0);
    coalescer.dispose();
  });

  it('빈 청크는 무시한다', () => {
    const { clock, flushed, coalescer } = setup();
    coalescer.push(new Uint8Array());
    clock.advance(100);
    expect(flushed).toEqual([]);
    coalescer.dispose();
  });

  it('dispose하면 남은 타이머를 정리하고 더 이상 내보내지 않는다', () => {
    const { clock, flushed, coalescer } = setup();
    coalescer.push(b('ab'));
    coalescer.dispose();
    clock.advance(100);
    expect(flushed).toEqual([]);
    expect(clock.pendingCount).toBe(0);
  });
});
