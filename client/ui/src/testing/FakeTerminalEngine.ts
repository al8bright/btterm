import type { EngineHooks, EngineOptions, TerminalEngine } from '../terminal/TerminalEngine';

/** 테스트용 터미널 엔진. 쓴 바이트·붙여넣기·스크롤을 기록하고 사용자 동작을 흉내 낸다. */
export class FakeTerminalEngine implements TerminalEngine {
  written = '';
  pasted: string[] = [];
  scrolled: string[] = [];
  opened = 0;
  disposed = false;
  focused = 0;
  gpu = false;
  altBuffer = false;
  mouseTracking = false;
  size: { cols: number; rows: number } | null = { cols: 80, rows: 24 };
  options: EngineOptions | null = null;
  #selection = '';
  /** 실제 xterm처럼 포커스를 받는 입력 요소 */
  #textarea: HTMLTextAreaElement | null = null;

  constructor(private readonly hooks: EngineHooks) {}

  open(parent: HTMLElement): void {
    this.opened += 1;
    this.#textarea = document.createElement('textarea');
    parent.append(this.#textarea);
  }
  write(data: Uint8Array, done: () => void): void {
    this.written += new TextDecoder().decode(data);
    done();
  }
  fit(): { cols: number; rows: number } | null {
    return this.size;
  }
  focus(): void {
    this.focused += 1;
    this.#textarea?.focus();
  }
  paste(text: string): void {
    this.pasted.push(text);
  }
  getSelection(): string {
    return this.#selection;
  }
  scrollPages(amount: number): void {
    this.scrolled.push(`page:${amount}`);
  }
  scrollLines(amount: number): void {
    this.scrolled.push(`line:${amount}`);
  }
  clearScrollback(): void {
    this.scrolled.push('clear');
  }
  isAlternateBuffer(): boolean {
    return this.altBuffer;
  }
  isMouseTracking(): boolean {
    return this.mouseTracking;
  }
  find(query: string): boolean {
    return this.written.includes(query);
  }
  clearFind(): void {}
  setOptions(options: EngineOptions): void {
    this.options = options;
  }
  setGpu(enabled: boolean): void {
    this.gpu = enabled;
  }
  bufferText(): string {
    return this.written;
  }
  dispose(): void {
    this.disposed = true;
  }

  // 사용자 동작 흉내
  type(data: string): void {
    this.hooks.onInput(data);
  }
  key(event: KeyboardEvent): boolean {
    return this.hooks.onKey(event);
  }
  select(text: string): void {
    this.#selection = text;
    this.hooks.onSelection(text);
  }
  clickLink(url: string): void {
    this.hooks.onLink(url);
  }
  osc7(payload: string): void {
    this.hooks.onOsc7(payload);
  }
}
