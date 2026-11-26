import type {
  BtTermApi,
  KeymapPlatform,
  MainToRendererEvent,
  RendererToMainRequest,
  SessionChannel,
  SessionHandlers,
} from '@btterm/core';

type Handler = (request: RendererToMainRequest) => unknown;

/** 테스트용 preload API. 요청을 기록하고, 이벤트·세션 바이트를 흘려 넣는 도우미를 제공한다(DESIGN §11). */
export class FakeBtTermApi implements BtTermApi {
  readonly platform: KeymapPlatform = 'windows';
  readonly requests: RendererToMainRequest[] = [];
  readonly written = new Map<string, string[]>();
  readonly resized = new Map<string, Array<{ cols: number; rows: number }>>();
  readonly #listeners = new Set<(event: MainToRendererEvent) => void>();
  readonly #sessions = new Map<string, SessionHandlers>();
  readonly #handlers = new Map<RendererToMainRequest['type'], Handler>();

  /** 요청 종류별 응답을 정한다. 없으면 { ok: true }. */
  on<T extends RendererToMainRequest['type']>(
    type: T,
    handler: (request: Extract<RendererToMainRequest, { type: T }>) => unknown,
  ): this {
    this.#handlers.set(type, handler as Handler);
    return this;
  }

  async invoke(request: RendererToMainRequest): Promise<unknown> {
    this.requests.push(request);
    const handler = this.#handlers.get(request.type);
    return handler ? handler(request) : { ok: true };
  }

  onEvent(listener: (event: MainToRendererEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  attachSession(sessionId: string, handlers: SessionHandlers): SessionChannel {
    this.#sessions.set(sessionId, handlers);
    return {
      write: (data) => this.written.set(sessionId, [...(this.written.get(sessionId) ?? []), data]),
      resize: (cols, rows) =>
        this.resized.set(sessionId, [...(this.resized.get(sessionId) ?? []), { cols, rows }]),
      ack: () => undefined,
      detach: () => this.#sessions.delete(sessionId),
    };
  }

  pathForFile(file: unknown): string {
    return (file as { testPath?: string }).testPath ?? '';
  }

  emit(event: MainToRendererEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }

  sendData(sessionId: string, text: string): void {
    this.#sessions.get(sessionId)?.onData(new TextEncoder().encode(text));
  }

  isAttached(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  requestsOf<T extends RendererToMainRequest['type']>(
    type: T,
  ): Array<Extract<RendererToMainRequest, { type: T }>> {
    return this.requests.filter(
      (r): r is Extract<RendererToMainRequest, { type: T }> => r.type === type,
    );
  }
}
