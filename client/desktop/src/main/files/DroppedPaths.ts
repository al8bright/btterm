const TTL_MS = 60_000;

/**
 * 탐색기에서 끌어 놓은 파일 경로 허용 목록(F4.3). preload가 webUtils로 얻은 경로만 창별로 짧게 등록하고,
 * main은 여기에 있는 경로만 업로드한다. renderer가 임의 경로(예: ~/.ssh/id_ed25519)를 지어내도
 * 올릴 수 없다(보안 리뷰 2026-10-20 #1).
 */
export class DroppedPaths {
  readonly #byOwner = new Map<object, Map<string, number>>();

  constructor(private readonly now: () => number) {}

  register(owner: object, path: string): void {
    const paths = this.#byOwner.get(owner) ?? new Map<string, number>();
    paths.set(path, this.now() + TTL_MS);
    this.#byOwner.set(owner, paths);
  }

  /** 모두 유효하면 소비하고 true. 하나라도 아니면 아무것도 바꾸지 않고 false. */
  consume(owner: object, paths: readonly string[]): boolean {
    const known = this.#byOwner.get(owner);
    const now = this.now();
    if (!known || !paths.every((p) => (known.get(p) ?? 0) > now)) return false;
    for (const path of paths) known.delete(path);
    return true;
  }

  forget(owner: object): void {
    this.#byOwner.delete(owner);
  }
}
