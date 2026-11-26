import type { Cancel, Clock } from './Clock';

interface Timer {
  id: number;
  due: number;
  fn: () => void;
}

/** 테스트용 시계. advance()로만 시간이 흐른다. */
export class FakeClock implements Clock {
  #now: number;
  #seq = 0;
  #timers: Timer[] = [];

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  setTimeout(fn: () => void, ms: number): Cancel {
    const timer = { id: ++this.#seq, due: this.#now + ms, fn };
    this.#timers.push(timer);
    return () => {
      this.#timers = this.#timers.filter((t) => t.id !== timer.id);
    };
  }

  advance(ms: number): void {
    const target = this.#now + ms;
    for (let next = this.#nextDue(target); next; next = this.#nextDue(target)) {
      this.#timers = this.#timers.filter((t) => t.id !== next.id);
      this.#now = next.due;
      next.fn();
    }
    this.#now = target;
  }

  get pendingCount(): number {
    return this.#timers.length;
  }

  #nextDue(limit: number): Timer | undefined {
    return this.#timers
      .filter((t) => t.due <= limit)
      .sort((a, b) => a.due - b.due || a.id - b.id)[0];
  }
}
