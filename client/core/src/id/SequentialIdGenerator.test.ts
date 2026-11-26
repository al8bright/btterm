import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator } from './SequentialIdGenerator';

describe('SequentialIdGenerator', () => {
  it('접두사와 순번으로 결정적인 ID를 만든다', () => {
    const ids = new SequentialIdGenerator('t');
    expect([ids.next(), ids.next()]).toEqual(['t-1', 't-2']);
  });
});
