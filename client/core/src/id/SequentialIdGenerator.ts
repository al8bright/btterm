import type { IdGenerator } from './IdGenerator';

/** 테스트용 결정적 ID 생성기. */
export class SequentialIdGenerator implements IdGenerator {
  #seq = 0;

  constructor(private readonly prefix = 'id') {}

  next(): string {
    this.#seq += 1;
    return `${this.prefix}-${this.#seq}`;
  }
}
