import {
  CwdTracker,
  matchShortcut,
  parseOsc7,
  preparePaste,
  toPromptInput,
  type AppAction,
  type BtTermApi,
  type KeymapPlatform,
  type SessionChannel,
  type TerminalSettings,
} from '@btterm/core';
import type { EngineFactory, EngineOptions, TerminalEngine } from './TerminalEngine';
import { TERMINAL_THEMES } from './themes';

interface RegistryDeps {
  api: BtTermApi;
  platform: KeymapPlatform;
  createEngine: EngineFactory;
  /** 터미널이 처리하지 않는 앱 단축키(탭·패널 등) */
  onAction(action: AppAction, sessionId: string): void;
  /** SEC-6: 링크는 확인 후 연다 */
  onLink(url: string): void;
  /** F3.9: 여러 줄 붙여넣기 확인 */
  confirmPaste(lineCount: number): Promise<boolean>;
  /** F4.5: 원격 셸이 알린 현재 폴더 */
  onCwd?(sessionId: string, path: string): void;
  /** 연결이 끊겼거나 실패한 세션인가(Enter = 다시 연결, Esc = 탭 닫기) */
  sessionEnded?(sessionId: string): boolean;
  /** 지금 쓸 수 있는 단축키인가. 아니면 터미널로 보낸다(칸 하나일 때의 칸 조작 키, 결정 UX2) */
  isAvailable?(action: AppAction): boolean;
}

/** 끊긴 세션에서 받는 키(PRD §4.2 "연결 끊김") */
const ENDED_KEYS: Readonly<Record<string, AppAction>> = {
  Enter: 'reconnect',
  NumpadEnter: 'reconnect',
  Escape: 'closeTab',
};

interface Entry {
  engine: TerminalEngine;
  element: HTMLDivElement;
  channel: SessionChannel;
  opened: boolean;
  lastSize: { cols: number; rows: number } | null;
  override: Partial<TerminalSettings>;
  cwd: CwdTracker;
  /** 받은 바이트 수(성능 측정용) */
  received: number;
  onContextMenu: (event: MouseEvent) => void;
  /** 원격 크기 알림 지연 타이머(fitDeferred) */
  resizeTimer?: ReturnType<typeof setTimeout>;
}

/** 리사이즈가 멈춘 뒤 원격에 크기를 알리기까지의 시간 */
const REMOTE_RESIZE_MS = 100;

/** 레지스트리가 직접 처리하는 단축키(터미널 화면 조작). */
const TERMINAL_ACTIONS: Partial<
  Record<AppAction, (registry: TerminalRegistry, id: string) => void>
> = {
  copy: (r, id) => void r.copySelection(id),
  paste: (r, id) => void r.pasteFromClipboard(id),
  scrollPageUp: (r, id) => r.engineOf(id)?.scrollPages(-1),
  scrollPageDown: (r, id) => r.engineOf(id)?.scrollPages(1),
  scrollLineUp: (r, id) => r.engineOf(id)?.scrollLines(-1),
  scrollLineDown: (r, id) => r.engineOf(id)?.scrollLines(1),
  clearScrollback: (r, id) => r.engineOf(id)?.clearScrollback(),
};

const SCROLL_ACTIONS = new Set<AppAction>([
  'scrollPageUp',
  'scrollPageDown',
  'scrollLineUp',
  'scrollLineDown',
]);

/**
 * 세션별 터미널 엔진을 React 밖에서 소유한다(DESIGN §11, AGENTS §3).
 * 컴포넌트는 mount/unmount만 하고, 바이트는 store를 거치지 않고 여기로 바로 온다.
 */
export class TerminalRegistry {
  readonly #deps: RegistryDeps;
  readonly #entries = new Map<string, Entry>();
  #defaults: TerminalSettings | null = null;

  constructor(deps: RegistryDeps) {
    this.#deps = deps;
  }

  has(sessionId: string): boolean {
    return this.#entries.has(sessionId);
  }

  sessionIds(): string[] {
    return [...this.#entries.keys()];
  }

  engineOf(sessionId: string): TerminalEngine | undefined {
    return this.#entries.get(sessionId)?.engine;
  }

  /** 세션의 터미널 요소를 container에 붙인다. 처음이면 엔진을 만들고 채널에 연결한다. */
  mount(sessionId: string, container: HTMLElement): void {
    const entry = this.#entries.get(sessionId) ?? this.#create(sessionId);
    container.append(entry.element);
    if (!entry.opened) {
      entry.engine.open(entry.element);
      entry.opened = true;
    }
    this.#paintHost(entry);
  }

  /** container에 붙어 있을 때만 뗀다. 다른 칸으로 옮겨 이미 새 자리에 붙었으면 두고 간다(F3.10a). */
  unmount(sessionId: string, container: HTMLElement): void {
    const element = this.#entries.get(sessionId)?.element;
    if (element?.parentElement === container) element.remove();
  }

  /** 보이는 터미널(분할 시 여러 개): GPU 렌더러·크기 맞춤. 숨긴 터미널은 GPU를 끈다(F3.5). */
  setVisible(sessionId: string, visible: boolean): void {
    const entry = this.#entries.get(sessionId);
    if (!entry) return;
    entry.engine.setGpu(visible);
    if (visible) this.fit(sessionId);
  }

  /** AC4: 크기가 실제로 바뀌었을 때만 원격 PTY에 알린다. 숨긴 탭(0 크기)은 보내지 않는다. */
  fit(sessionId: string): void {
    const entry = this.#entries.get(sessionId);
    const size = entry?.engine.fit();
    if (!entry || !size) return;
    if (entry.lastSize && entry.lastSize.cols === size.cols && entry.lastSize.rows === size.rows) {
      return;
    }
    entry.lastSize = size;
    entry.channel.resize(size.cols, size.rows);
  }

  /**
   * 리사이즈 중(F3.2, 리뷰 M4): 화면은 바로 맞추고, 원격 PTY 크기 알림은 멈춘 뒤 한 번만 보낸다.
   * 프레임마다 SIGWINCH를 보내면 vim·htop이 계속 다시 그린다.
   */
  fitDeferred(sessionId: string): void {
    const entry = this.#entries.get(sessionId);
    if (!entry) return;
    entry.engine.fit();
    clearTimeout(entry.resizeTimer);
    entry.resizeTimer = setTimeout(() => this.fit(sessionId), REMOTE_RESIZE_MS);
  }

  focus(sessionId: string): void {
    this.#entries.get(sessionId)?.engine.focus();
  }

  async copySelection(sessionId: string): Promise<void> {
    const text = this.#entries.get(sessionId)?.engine.getSelection();
    if (text) await this.#deps.api.invoke({ type: 'clipboard.writeText', text });
  }

  async pasteFromClipboard(sessionId: string): Promise<void> {
    const result = (await this.#deps.api.invoke({ type: 'clipboard.readText' })) as {
      text?: string;
    };
    const prepared = preparePaste(result.text ?? '');
    if (prepared.text === '') return;
    if (prepared.multiline && !(await this.#deps.confirmPaste(prepared.lineCount))) return;
    this.#entries.get(sessionId)?.engine.paste(prepared.text);
  }

  /**
   * F3.17a: 프롬프트에 입력만 한다(실행하지 않음). bracketed paste로 보내 셸이 바로 실행하지 않게 하고,
   * vim 같은 전체 화면 앱 안에서는 막는다(DESIGN §5.6).
   */
  insertText(sessionId: string, text: string): boolean {
    const entry = this.#entries.get(sessionId);
    if (!entry || entry.engine.isAlternateBuffer()) return false;
    entry.engine.paste(toPromptInput(text));
    entry.engine.focus();
    return true;
  }

  /** 프롬프트에 입력(insertText와 같은 규칙)한 뒤 붙여넣기 괄호 밖에서 Enter(F3.14 실행) */
  runCommand(sessionId: string, text: string): boolean {
    if (!this.insertText(sessionId, text)) return false;
    this.#entries.get(sessionId)?.channel.write('\r');
    return true;
  }

  find(sessionId: string, query: string, direction: 'next' | 'previous'): boolean {
    return this.#entries.get(sessionId)?.engine.find(query, direction) ?? false;
  }

  clearFind(sessionId: string): void {
    this.#entries.get(sessionId)?.engine.clearFind();
  }

  /** 전체 기본값(F3.16 "전체 기본값"). 탭별 재정의는 유지한다. */
  applyDefaults(settings: TerminalSettings): void {
    this.#defaults = settings;
    for (const entry of this.#entries.values()) this.#applyOptions(entry);
  }

  /** F3.16 "이 탭만" */
  overrideTab(sessionId: string, override: Partial<TerminalSettings>): void {
    const entry = this.#entries.get(sessionId);
    if (!entry) return;
    entry.override = { ...entry.override, ...override };
    this.#applyOptions(entry);
  }

  effectiveSettings(sessionId: string): TerminalSettings | null {
    const entry = this.#entries.get(sessionId);
    if (!this.#defaults) return null;
    return { ...this.#defaults, ...entry?.override };
  }

  receivedBytes(sessionId: string): number {
    return this.#entries.get(sessionId)?.received ?? 0;
  }

  bufferText(sessionId?: string): string {
    const entry = sessionId ? this.#entries.get(sessionId) : [...this.#entries.values()].at(-1);
    return entry?.engine.bufferText() ?? '';
  }

  /** 새 연결(재접속)이면 OSC 7 호스트 기억을 지운다. */
  resetCwd(sessionId: string): void {
    this.#entries.get(sessionId)?.cwd.reset();
  }

  dispose(sessionId: string): void {
    const entry = this.#entries.get(sessionId);
    if (!entry) return;
    this.#entries.delete(sessionId);
    clearTimeout(entry.resizeTimer);
    entry.element.removeEventListener('contextmenu', entry.onContextMenu);
    entry.channel.detach();
    entry.engine.dispose();
    entry.element.remove();
  }

  disposeAll(): void {
    for (const id of [...this.#entries.keys()]) this.dispose(id);
  }

  #create(sessionId: string): Entry {
    const element = document.createElement('div');
    element.className = 'terminal-surface';
    const engine = this.#deps.createEngine({
      onInput: (data) => this.#entries.get(sessionId)?.channel.write(data),
      onSelection: (text) => {
        // F3.8: 선택 = 복사
        if (text) void this.#deps.api.invoke({ type: 'clipboard.writeText', text });
      },
      onLink: (url) => this.#deps.onLink(url),
      onKey: (event) => this.#onKey(sessionId, event),
      onOsc7: (payload) => this.#onOsc7(sessionId, payload),
    });
    const channel = this.#deps.api.attachSession(sessionId, {
      onData: (bytes) => {
        const entry = this.#entries.get(sessionId);
        if (entry) entry.received += bytes.length;
        engine.write(bytes, () => channel.ack(bytes.length));
      },
      onExit: () => engine.write(new TextEncoder().encode('\r\n'), () => undefined),
    });
    const onContextMenu = (event: MouseEvent) => {
      // F3.8 우클릭 = 붙여넣기. 원격 앱이 마우스를 쓰면 Shift+우클릭만(DESIGN §8.2).
      event.preventDefault();
      if (engine.isMouseTracking() && !event.shiftKey) return;
      void this.pasteFromClipboard(sessionId);
    };
    element.addEventListener('contextmenu', onContextMenu);
    const entry: Entry = {
      engine,
      element,
      channel,
      opened: false,
      lastSize: null,
      override: {},
      cwd: new CwdTracker(),
      received: 0,
      onContextMenu,
    };
    this.#entries.set(sessionId, entry);
    if (this.#defaults) this.#applyOptions(entry);
    return entry;
  }

  /** SEC-5: 형식이 맞고 처음 본 원격 호스트의 보고만 받는다. */
  #onOsc7(sessionId: string, payload: string): void {
    const report = parseOsc7(payload);
    const entry = this.#entries.get(sessionId);
    if (!report || !entry || !entry.cwd.accept(report)) return;
    this.#deps.onCwd?.(sessionId, report.path);
  }

  /** true = 터미널이 처리, false = 가로챔(SEC-8: Ctrl+(문자)는 항상 터미널로). */
  #onKey(sessionId: string, event: KeyboardEvent): boolean {
    const ended = ENDED_KEYS[event.code];
    if (
      ended &&
      !hasModifier(event) &&
      !event.isComposing &&
      this.#deps.sessionEnded?.(sessionId)
    ) {
      // 누르고 있으면 다시 연결 요청이 거듭 가지 않게 첫 keydown만 처리한다
      if (event.type === 'keydown' && !event.repeat) {
        event.preventDefault();
        this.#deps.onAction(ended, sessionId);
      }
      return false;
    }
    const action = matchShortcut(event, this.#deps.platform);
    if (!action || this.#deps.isAvailable?.(action) === false) return true;
    const engine = this.#entries.get(sessionId)?.engine;
    if (SCROLL_ACTIONS.has(action) && engine?.isAlternateBuffer()) return true;
    if (event.type === 'keydown') {
      event.preventDefault();
      const local = TERMINAL_ACTIONS[action];
      if (local) local(this, sessionId);
      else this.#deps.onAction(action, sessionId);
    }
    return false;
  }

  #applyOptions(entry: Entry): void {
    if (!this.#defaults) return;
    const settings = { ...this.#defaults, ...entry.override };
    const options: EngineOptions = {
      theme: TERMINAL_THEMES[settings.themeId],
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      cursorStyle: settings.cursor,
    };
    entry.engine.setOptions(options);
    this.#paintHost(entry);
  }

  /** 터미널 둘레 여백(host padding)을 테마 배경으로 칠한다. 라이트 화면 + 어두운 터미널이 액자처럼 보이지 않게. */
  #paintHost(entry: Entry): void {
    if (!this.#defaults) return;
    const themeId = entry.override.themeId ?? this.#defaults.themeId;
    entry.element.parentElement?.style.setProperty(
      '--terminal-bg',
      TERMINAL_THEMES[themeId].background ?? null,
    );
  }
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
}
