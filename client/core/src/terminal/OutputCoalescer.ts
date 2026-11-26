import type { Cancel, Clock } from '../time/Clock';
import type { Disposable, ResourceTracker } from '../resource/ResourceTracker';

export interface OutputCoalescerOptions {
  clock: Clock;
  tracker: ResourceTracker;
  /** 이만큼 모이면 즉시 내보낸다. 기본 64KB. */
  maxBytes?: number;
  /** 첫 청크 후 이 시간이 지나면 내보낸다. 기본 16ms. */
  maxDelayMs?: number;
  onFlush: (chunk: Uint8Array) => void;
}

/** 터미널 출력 청크를 모아 IPC 메시지 수를 줄인다(F3.4, PRD §5.2). */
export class OutputCoalescer implements Disposable {
  readonly #clock: Clock;
  readonly #maxBytes: number;
  readonly #maxDelayMs: number;
  readonly #onFlush: (chunk: Uint8Array) => void;
  readonly #handle: Disposable;
  #pending: Uint8Array[] = [];
  #size = 0;
  #cancelTimer: Cancel | null = null;
  #disposed = false;

  constructor(options: OutputCoalescerOptions) {
    this.#clock = options.clock;
    this.#maxBytes = options.maxBytes ?? 64 * 1024;
    this.#maxDelayMs = options.maxDelayMs ?? 16;
    this.#onFlush = options.onFlush;
    this.#handle = options.tracker.track('output-coalescer', () => this.#cancel());
  }

  push(chunk: Uint8Array): void {
    if (this.#disposed || chunk.length === 0) return;
    this.#pending.push(chunk);
    this.#size += chunk.length;
    if (this.#size >= this.#maxBytes) {
      this.flush();
      return;
    }
    this.#cancelTimer ??= this.#clock.setTimeout(() => this.flush(), this.#maxDelayMs);
  }

  flush(): void {
    this.#cancel();
    if (this.#size === 0) return;
    const out = new Uint8Array(this.#size);
    let offset = 0;
    for (const part of this.#pending) {
      out.set(part, offset);
      offset += part.length;
    }
    this.#pending = [];
    this.#size = 0;
    this.#onFlush(out);
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending = [];
    this.#size = 0;
    this.#handle.dispose();
  }

  #cancel(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }
}
