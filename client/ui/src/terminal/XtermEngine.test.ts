import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ITerminalOptions } from '@xterm/xterm';
import { XtermEngine } from './XtermEngine';

// 엔진이 xterm에 넘긴 옵션을 본다(실제 Terminal은 그대로 쓴다)
const created = vi.hoisted(() => [] as ITerminalOptions[]);
vi.mock('@xterm/xterm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xterm/xterm')>();
  class Terminal extends actual.Terminal {
    constructor(options?: ITerminalOptions) {
      super(options);
      created.push(options ?? {});
    }
  }
  return { ...actual, Terminal };
});

const engines: XtermEngine[] = [];

// jsdom에는 matchMedia가 없다. xterm은 화면 배율 변화를 듣는 데만 쓴다.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as MediaQueryList;

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  document.body.replaceChildren();
});

function openEngine(onInput: (data: string) => void): HTMLElement {
  const engine = new XtermEngine({
    onInput,
    onSelection: () => undefined,
    onLink: () => undefined,
    onKey: () => true,
    onOsc7: () => undefined,
  });
  engines.push(engine);
  const parent = document.createElement('div');
  document.body.append(parent);
  engine.open(parent);
  return parent;
}

describe('XtermEngine 링크 (SEC-5)', () => {
  it('SEC-5 OSC 8 하이퍼링크도 xterm 기본 confirm·window.open이 아니라 앱 링크 확인 경로로 연다', () => {
    const onLink = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const engine = new XtermEngine({
      onInput: () => undefined,
      onSelection: () => undefined,
      onLink,
      onKey: () => true,
      onOsc7: () => undefined,
    });
    engines.push(engine);
    const options = created.at(-1);
    expect(options?.linkHandler).toBeTruthy();
    // http(s)가 아닌 OSC 8 링크는 xterm이 아예 건네지 않는다(javascript:, file: 등)
    expect(options?.linkHandler?.allowNonHttpProtocols ?? false).toBe(false);
    const range = { start: { x: 1, y: 1 }, end: { x: 5, y: 1 } };
    options?.linkHandler?.activate(new MouseEvent('click'), 'https://evil.example/x', range);
    expect(onLink).toHaveBeenCalledWith('https://evil.example/x');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

describe('XtermEngine 붙여넣기 (SEC-5)', () => {
  it('브라우저 paste 이벤트(macOS 편집 메뉴 등)는 터미널로 보내지 않는다. 붙여넣기는 정제 경로로만', () => {
    const onInput = vi.fn();
    const parent = openEngine(onInput);
    const textarea = parent.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => 'rm -rf /\x1b[201~\r' },
    });
    textarea!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onInput).not.toHaveBeenCalled();
  });
});
