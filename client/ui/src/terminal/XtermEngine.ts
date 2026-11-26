import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { EngineHooks, EngineOptions, TerminalEngine } from './TerminalEngine';

const SEARCH_DECORATIONS = {
  matchOverviewRuler: '#F5A524',
  activeMatchColorOverviewRuler: '#4C9BFF',
  activeMatchBackground: '#4C9BFF66',
  matchBackground: '#F5A52444',
};

/** xterm 6 기반 엔진(F3.1~F3.9). SEC-5: windowOptions는 기본값(모두 false)을 유지한다. */
export class XtermEngine implements TerminalEngine {
  readonly #term: Terminal;
  readonly #fit = new FitAddon();
  readonly #search = new SearchAddon();
  #webgl: WebglAddon | null = null;
  #parent: HTMLElement | null = null;
  readonly #onMouseUp: () => void;
  /**
   * SEC-5: 브라우저 paste 이벤트(macOS 편집 메뉴 등)는 xterm이 제어문자를 거르지 않고 보낸다.
   * 붙여넣기는 키맵·우클릭의 정제 경로(TerminalRegistry.pasteFromClipboard)로만 한다.
   */
  readonly #onNativePaste = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  constructor(hooks: EngineHooks) {
    this.#term = new Terminal({
      allowProposedApi: true,
      lineHeight: 1.2,
      scrollback: 10_000,
      minimumContrastRatio: 4.5,
      rightClickSelectsWord: false,
      // SEC-5: OSC 8 하이퍼링크도 WebLinks와 같은 앱 확인 경로(http(s)만 + 확인창)로 연다.
      // 없으면 xterm 기본 처리(confirm + window.open)를 탄다. 비 HTTP 링크는 받지 않는다(기본값 false)
      linkHandler: { activate: (_event, uri) => hooks.onLink(uri) },
    });
    this.#term.loadAddon(this.#fit);
    this.#term.loadAddon(this.#search);
    this.#term.loadAddon(new Unicode11Addon());
    this.#term.loadAddon(new WebLinksAddon((_event, uri) => hooks.onLink(uri)));
    this.#term.onData(hooks.onInput);
    this.#term.attachCustomKeyEventHandler(hooks.onKey);
    // F4.5 폴더 따라가기: OSC 7을 소비하고 레지스트리에 넘긴다.
    this.#term.parser.registerOscHandler(7, (payload) => {
      hooks.onOsc7(payload);
      return true;
    });
    // F3.8 선택 = 복사: 드래그 중 매번이 아니라 마우스를 놓을 때 한 번 복사한다.
    this.#onMouseUp = () => {
      if (this.#term.hasSelection()) hooks.onSelection(this.#term.getSelection());
    };
  }

  open(parent: HTMLElement): void {
    this.#parent = parent;
    this.#term.open(parent);
    this.#term.unicode.activeVersion = '11';
    parent.addEventListener('mouseup', this.#onMouseUp);
    // 캡처 단계에서 xterm 입력칸의 paste 처리보다 먼저 막는다
    parent.addEventListener('paste', this.#onNativePaste, true);
  }

  write(data: Uint8Array, done: () => void): void {
    this.#term.write(data, done);
  }

  fit(): { cols: number; rows: number } | null {
    const parent = this.#parent;
    if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return null;
    this.#fit.fit();
    return { cols: this.#term.cols, rows: this.#term.rows };
  }

  focus(): void {
    this.#term.focus();
  }

  paste(text: string): void {
    this.#term.paste(text);
  }

  getSelection(): string {
    return this.#term.getSelection();
  }

  scrollPages(amount: number): void {
    this.#term.scrollPages(amount);
  }

  scrollLines(amount: number): void {
    this.#term.scrollLines(amount);
  }

  clearScrollback(): void {
    this.#term.clear();
  }

  isAlternateBuffer(): boolean {
    return this.#term.buffer.active.type === 'alternate';
  }

  isMouseTracking(): boolean {
    return this.#term.modes.mouseTrackingMode !== 'none';
  }

  find(query: string, direction: 'next' | 'previous'): boolean {
    const options = { decorations: SEARCH_DECORATIONS };
    return direction === 'next'
      ? this.#search.findNext(query, options)
      : this.#search.findPrevious(query, options);
  }

  clearFind(): void {
    this.#search.clearDecorations();
    this.#term.clearSelection();
  }

  setOptions(options: EngineOptions): void {
    this.#term.options.theme = options.theme;
    this.#term.options.fontFamily = options.fontFamily;
    this.#term.options.fontSize = options.fontSize;
    this.#term.options.cursorStyle = options.cursorStyle;
    if (this.#parent) this.fit();
  }

  /** 보이는 탭만 WebGL(F3.5). 컨텍스트를 잃으면 DOM 렌더러로 돌아간다. */
  setGpu(enabled: boolean): void {
    if (!enabled) {
      this.#webgl?.dispose();
      this.#webgl = null;
      return;
    }
    if (this.#webgl || !this.#parent) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        if (this.#webgl === webgl) this.#webgl = null;
      });
      this.#term.loadAddon(webgl);
      this.#webgl = webgl;
    } catch {
      this.#webgl = null;
    }
  }

  bufferText(): string {
    const buffer = this.#term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  }

  dispose(): void {
    this.#parent?.removeEventListener('mouseup', this.#onMouseUp);
    this.#parent?.removeEventListener('paste', this.#onNativePaste, true);
    this.#webgl?.dispose();
    this.#term.dispose();
  }
}
