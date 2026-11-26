import { afterEach, describe, expect, it, vi } from 'vitest';
import { XtermEngine } from './XtermEngine';

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
