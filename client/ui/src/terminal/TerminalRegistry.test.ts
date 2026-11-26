import { describe, expect, it, vi } from 'vitest';
import type { AppAction } from '@btterm/core';
import { FakeBtTermApi } from '../testing/FakeBtTermApi';
import { FakeTerminalEngine } from '../testing/FakeTerminalEngine';
import { TerminalRegistry } from './TerminalRegistry';

function setup(options: { clipboard?: string; confirmPaste?: boolean; ended?: boolean } = {}) {
  let clipboard = options.clipboard ?? '';
  const api = new FakeBtTermApi()
    .on('clipboard.readText', () => ({ text: clipboard }))
    .on('clipboard.writeText', (r) => {
      clipboard = r.text;
      return { ok: true };
    });
  const engines: FakeTerminalEngine[] = [];
  const actions: Array<[AppAction, string]> = [];
  const links: string[] = [];
  const confirms: number[] = [];
  const registry = new TerminalRegistry({
    api,
    platform: 'windows',
    createEngine: (hooks) => {
      const engine = new FakeTerminalEngine(hooks);
      engines.push(engine);
      return engine;
    },
    onAction: (action, sessionId) => actions.push([action, sessionId]),
    onLink: (url) => links.push(url),
    confirmPaste: async (lineCount) => {
      confirms.push(lineCount);
      return options.confirmPaste ?? true;
    },
    sessionEnded: () => options.ended ?? false,
  });
  const container = document.createElement('div');
  document.body.append(container);
  registry.mount('s1', container);
  const engine = engines[0]!;
  return { api, registry, engine, actions, links, confirms, clipboard: () => clipboard, container };
}

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  new KeyboardEvent('keydown', { code, ctrlKey: false, shiftKey: false, ...mods });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TerminalRegistry', () => {
  it('세션 바이트를 엔진에 쓰고 처리 후 ack, 입력은 채널로 보낸다', () => {
    const { api, engine } = setup();
    api.sendData('s1', 'hello');
    expect(engine.written).toBe('hello');
    engine.type('ls\r');
    expect(api.written.get('s1')).toEqual(['ls\r']);
  });

  it('같은 세션을 다시 mount해도 엔진은 하나이고 버퍼가 유지된다(탭 전환)', () => {
    const { api, registry, engine, container } = setup();
    api.sendData('s1', 'keep');
    registry.unmount('s1', container);
    registry.mount('s1', container);
    expect(engine.opened).toBe(1);
    expect(engine.written).toBe('keep');
  });

  it('F3.10a 다른 칸으로 옮긴 뒤 이전 자리의 unmount는 새 자리의 터미널을 떼지 않는다', () => {
    const { registry, container } = setup();
    const next = document.createElement('div');
    registry.mount('s1', next);
    registry.unmount('s1', container);
    expect(next.querySelector('.terminal-surface')).not.toBeNull();
    registry.unmount('s1', next);
    expect(next.querySelector('.terminal-surface')).toBeNull();
  });

  it('AC4 크기가 바뀔 때만 resize를 보내고 0 크기는 보내지 않는다', () => {
    const { api, registry, engine } = setup();
    engine.size = { cols: 100, rows: 30 };
    registry.fit('s1');
    registry.fit('s1');
    engine.size = null; // 숨긴 탭
    registry.fit('s1');
    expect(api.resized.get('s1')).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('SEC-8 Ctrl+(문자)는 터미널로, Ctrl+Shift 단축키는 앱 동작으로', () => {
    const { engine, actions } = setup();
    expect(engine.key(key('KeyW', { ctrlKey: true }))).toBe(true);
    expect(engine.key(key('KeyW', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(actions).toEqual([['closeTab', 's1']]);
  });

  it('끊긴 세션에서 Enter는 다시 연결, Esc는 탭 닫기(PRD §4.2 연결 끊김)', () => {
    const live = setup();
    expect(live.engine.key(key('Enter'))).toBe(true);
    expect(live.actions).toEqual([]);

    const { engine, actions } = setup({ ended: true });
    expect(engine.key(key('Enter'))).toBe(false);
    expect(engine.key(key('Escape'))).toBe(false);
    expect(engine.key(key('KeyA'))).toBe(true);
    expect(actions).toEqual([
      ['reconnect', 's1'],
      ['closeTab', 's1'],
    ]);
  });

  it('끊긴 세션에서 Enter를 누르고 있거나 한글 조합 중이면 다시 연결을 거듭 보내지 않는다(리뷰)', () => {
    const { engine, actions } = setup({ ended: true });
    expect(engine.key(key('Enter', { repeat: true }))).toBe(false);
    const composing = key('Enter');
    Object.defineProperty(composing, 'isComposing', { value: true });
    expect(engine.key(composing)).toBe(true);
    expect(actions).toEqual([]);
  });

  it('리사이즈 중에는 화면만 바로 맞추고 원격 크기 알림은 묶어서 한 번 보낸다(리뷰 M4)', () => {
    vi.useFakeTimers();
    try {
      const { api, registry, engine } = setup();
      engine.size = { cols: 90, rows: 30 };
      registry.fitDeferred('s1');
      engine.size = { cols: 100, rows: 30 };
      registry.fitDeferred('s1');
      expect(api.resized.get('s1') ?? []).toEqual([]);
      vi.advanceTimersByTime(150);
      expect(api.resized.get('s1')).toEqual([{ cols: 100, rows: 30 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('IME 조합 중에는 단축키를 가로채지 않는다', () => {
    const { engine, actions } = setup();
    const composing = key('KeyW', { ctrlKey: true, shiftKey: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    expect(engine.key(composing)).toBe(true);
    expect(actions).toEqual([]);
  });

  it('스크롤 단축키는 일반 화면에서 스크롤하고 alternate buffer(vim)에서는 원격으로 보낸다', () => {
    const { engine } = setup();
    expect(engine.key(key('PageUp', { shiftKey: true }))).toBe(false);
    expect(engine.scrolled).toEqual(['page:-1']);
    engine.altBuffer = true;
    expect(engine.key(key('PageUp', { shiftKey: true }))).toBe(true);
    expect(engine.scrolled).toEqual(['page:-1']);
  });

  it('F3.8 선택하면 복사하고, Ctrl+Shift+C도 복사한다', async () => {
    const env = setup();
    env.engine.select('selected text');
    await flush();
    expect(env.clipboard()).toBe('selected text');
    env.engine.select('again');
    env.engine.key(key('KeyC', { ctrlKey: true, shiftKey: true }));
    await flush();
    expect(env.clipboard()).toBe('again');
  });

  it('F3.9 붙여넣기는 제어문자를 지우고 bracketed paste로 보낸다', async () => {
    const env = setup({ clipboard: 'echo hi\u001b[201~\n' });
    env.engine.key(key('KeyV', { ctrlKey: true, shiftKey: true }));
    await flush();
    expect(env.engine.pasted).toEqual(['echo hi[201~\n']);
    expect(env.confirms).toEqual([]);
  });

  it('F3.9 여러 줄 붙여넣기는 확인을 받고, 거절하면 보내지 않는다', async () => {
    const env = setup({ clipboard: 'a\nb\nc', confirmPaste: false });
    await env.registry.pasteFromClipboard('s1');
    expect(env.confirms).toEqual([3]);
    expect(env.engine.pasted).toEqual([]);
  });

  it('우클릭은 붙여넣기, 원격 앱이 마우스를 쓰면 Shift+우클릭만 붙여넣기', async () => {
    const env = setup({ clipboard: 'x' });
    const rightClick = (shiftKey = false) =>
      env.container.firstElementChild!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey }),
      );
    expect(rightClick()).toBe(false); // 기본 메뉴 차단
    await flush();
    expect(env.engine.pasted).toEqual(['x']);
    env.engine.mouseTracking = true;
    rightClick();
    await flush();
    expect(env.engine.pasted).toEqual(['x']);
    rightClick(true);
    await flush();
    expect(env.engine.pasted).toEqual(['x', 'x']);
  });

  it('SEC-6 링크 클릭은 확인 단계로 넘긴다', () => {
    const { engine, links } = setup();
    engine.clickLink('https://example.com');
    expect(links).toEqual(['https://example.com']);
  });

  it('F3.17a 기록 입력은 한 줄로 붙여넣기(실행 안 함)만 하고, alternate buffer에서는 막는다', () => {
    const { api, registry, engine } = setup();
    expect(registry.insertText('s1', 'git log\n--oneline')).toBe(true);
    expect(engine.pasted).toEqual(['git log --oneline']);
    expect(api.written.get('s1')).toBeUndefined();
    engine.altBuffer = true;
    expect(registry.insertText('s1', 'ls')).toBe(false);
  });

  it('dispose하면 채널을 떼고 엔진을 정리한다', () => {
    const { api, registry, engine } = setup();
    registry.dispose('s1');
    expect(api.isAttached('s1')).toBe(false);
    expect(engine.disposed).toBe(true);
    expect(registry.has('s1')).toBe(false);
  });

  it('테마·글꼴 설정을 모든 터미널에 적용하고, 탭별 재정의를 우선한다', () => {
    const { registry, engine } = setup();
    registry.applyDefaults({
      themeId: 'one-dark',
      fontFamily: 'Mono',
      fontSize: 15,
      cursor: 'bar',
    });
    expect(engine.options).toMatchObject({ fontSize: 15, cursorStyle: 'bar' });
    registry.overrideTab('s1', { fontSize: 18 });
    expect(engine.options).toMatchObject({ fontSize: 18, cursorStyle: 'bar' });
    registry.applyDefaults({
      themeId: 'btterm-dark',
      fontFamily: 'Mono',
      fontSize: 12,
      cursor: 'block',
    });
    expect(engine.options).toMatchObject({ fontSize: 18, cursorStyle: 'block' });
  });

  it('터미널 둘레 여백은 그 탭의 터미널 테마 배경색이다(옮겨 붙여도 따라간다)', () => {
    const { registry, container } = setup();
    const settings = { fontFamily: 'Mono', fontSize: 13, cursor: 'block' } as const;
    registry.applyDefaults({ ...settings, themeId: 'one-dark' });
    expect(container.style.getPropertyValue('--terminal-bg')).toBe('#282C34');

    registry.overrideTab('s1', { themeId: 'github-light' });
    const light = container.style.getPropertyValue('--terminal-bg');
    expect(light).not.toBe('#282C34');

    const next = document.createElement('div');
    registry.mount('s1', next);
    expect(next.style.getPropertyValue('--terminal-bg')).toBe(light);
  });
});

describe('TerminalRegistry 폴더 따라가기(F4.5)', () => {
  function withCwd() {
    const cwds: Array<[string, string]> = [];
    const api = new FakeBtTermApi();
    const engines: FakeTerminalEngine[] = [];
    const registry = new TerminalRegistry({
      api,
      platform: 'windows',
      createEngine: (hooks) => {
        const engine = new FakeTerminalEngine(hooks);
        engines.push(engine);
        return engine;
      },
      onAction: () => undefined,
      onLink: () => undefined,
      confirmPaste: async () => true,
      onCwd: (sessionId, path) => cwds.push([sessionId, path]),
    });
    registry.mount('s1', document.createElement('div'));
    return { registry, engine: engines[0]!, cwds };
  }

  it('OSC 7을 받아 현재 폴더를 알리고, 처음 본 호스트와 다른 보고는 무시한다(SEC-5)', () => {
    const { engine, cwds } = withCwd();
    engine.osc7('file://web-01/var/log');
    engine.osc7('file://web-01/home/u/%ED%95%9C%EA%B8%80');
    engine.osc7('file://evil/etc');
    engine.osc7('not-a-url');
    expect(cwds).toEqual([
      ['s1', '/var/log'],
      ['s1', '/home/u/한글'],
    ]);
  });

  it('재접속하면(새 연결) 호스트 기억을 지운다', () => {
    const { registry, engine, cwds } = withCwd();
    engine.osc7('file://old/tmp');
    registry.resetCwd('s1');
    engine.osc7('file://new/srv');
    expect(cwds.at(-1)).toEqual(['s1', '/srv']);
  });
});

describe('TerminalRegistry 수신량(성능 측정, AC17)', () => {
  it('세션별로 받은 바이트 수를 센다', () => {
    const { api, registry } = setup();
    api.sendData('s1', 'abc');
    api.sendData('s1', '한');
    expect(registry.receivedBytes('s1')).toBe(6);
    expect(registry.receivedBytes('nope')).toBe(0);
  });
});
