export interface Disposable {
  dispose(): void;
}

/**
 * 자원 수명 추적기. 자원을 만드는 팩토리는 tracker를 받아 등록하고,
 * 테스트는 assertAllDisposed()로 누수를 검사한다(AGENTS.md §6).
 */
export class ResourceTracker {
  readonly #live = new Map<number, string>();
  #seq = 0;

  track(label: string, cleanup: () => void = () => undefined): Disposable {
    const id = ++this.#seq;
    this.#live.set(id, label);
    return {
      dispose: () => {
        if (!this.#live.delete(id)) return;
        cleanup();
      },
    };
  }

  get liveCount(): number {
    return this.#live.size;
  }

  assertAllDisposed(): void {
    if (this.#live.size === 0) return;
    const labels = [...this.#live.values()].join(', ');
    throw new Error(`해제되지 않은 자원 ${this.#live.size}개: ${labels}`);
  }
}
