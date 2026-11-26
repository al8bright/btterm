import type { ITheme } from '@xterm/xterm';

/** 엔진을 만들 때 넘기는 콜백. 엔진은 이벤트만 알리고 정책은 TerminalRegistry가 정한다. */
export interface EngineHooks {
  onInput(data: string): void;
  onSelection(text: string): void;
  onLink(url: string): void;
  /** true면 엔진(터미널)이 처리, false면 가로챔 */
  onKey(event: KeyboardEvent): boolean;
  /** OSC 7 페이로드(file://host/path). 검증은 레지스트리가 한다(SEC-5) */
  onOsc7(payload: string): void;
}

export interface EngineOptions {
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  cursorStyle: 'block' | 'underline' | 'bar';
}

/**
 * 터미널 렌더러 포트(DESIGN §11). 실제 구현은 xterm, 컴포넌트·레지스트리 테스트는 가짜를 쓴다.
 */
export interface TerminalEngine {
  open(parent: HTMLElement): void;
  write(data: Uint8Array, done: () => void): void;
  /** 부모 크기에 맞춘 열·행. 부모 크기가 0이면 null */
  fit(): { cols: number; rows: number } | null;
  focus(): void;
  /** bracketed paste 경로(F3.9) */
  paste(text: string): void;
  getSelection(): string;
  scrollPages(amount: number): void;
  scrollLines(amount: number): void;
  clearScrollback(): void;
  isAlternateBuffer(): boolean;
  isMouseTracking(): boolean;
  find(query: string, direction: 'next' | 'previous'): boolean;
  clearFind(): void;
  setOptions(options: EngineOptions): void;
  /** 보이는 탭만 GPU 렌더러를 쓴다(F3.5) */
  setGpu(enabled: boolean): void;
  bufferText(): string;
  dispose(): void;
}

export type EngineFactory = (hooks: EngineHooks) => TerminalEngine;
