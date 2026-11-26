import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySettingsPatch,
  defaultAppSettings,
  emptyProfileStore,
  toProfilesView,
  type AppSettings,
  type KeymapPlatform,
} from '@btterm/core';
import { App } from './App';
import { FakeBtTermApi } from './testing/FakeBtTermApi';
import { FakeTerminalEngine } from './testing/FakeTerminalEngine';

function setup(initial: Partial<AppSettings> = {}, platform: KeymapPlatform = 'windows') {
  let settings: AppSettings = { ...defaultAppSettings(), ...initial };
  let n = 0;
  const api = new FakeBtTermApi()
    .on('profiles.get', () =>
      toProfilesView({
        ...emptyProfileStore(),
        profiles: [
          {
            id: 'p1',
            groupId: null,
            name: 'web-01',
            host: '10.0.0.5',
            overrides: {},
            tags: [],
            updatedAt: 0,
          },
          {
            id: 'p2',
            groupId: null,
            name: 'db-01',
            host: '10.0.0.9',
            overrides: {},
            tags: [],
            updatedAt: 0,
          },
        ],
      }),
    )
    .on('settings.get', () => settings)
    .on('settings.update', (r) => {
      settings = applySettingsPatch(settings, r.patch);
      return settings;
    })
    .on('session.openQuick', () => ({ sessionId: `s${++n}` }))
    .on('session.openProfile', () => ({ sessionId: `s${++n}` }))
    .on('history.load', () => ({
      status: 'ok',
      entries: [
        { command: 'git status', timestamp: null },
        { command: 'docker ps -a', timestamp: null },
      ],
    }));
  const engines: FakeTerminalEngine[] = [];
  render(
    <App
      api={api}
      platform={platform}
      createEngine={(hooks) => {
        const engine = new FakeTerminalEngine(hooks);
        engines.push(engine);
        return engine;
      }}
    />,
  );
  return { api, engines };
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function quickConnect(target: string) {
  fireEvent.change(screen.getByRole('combobox', { name: '빠른 연결' }), {
    target: { value: target },
  });
  fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
  await flush();
}

describe('App 셸', () => {
  it('D12 macOS는 Cmd 키맵을 쓰고 헤더 왼쪽에 신호등 자리를 비운다', async () => {
    setup({}, 'mac');
    await flush();
    expect(document.querySelector('.app')?.getAttribute('data-platform')).toBe('mac');
    expect(document.querySelector('.app')?.getAttribute('data-fullscreen')).toBe('false');
    expect(screen.getByText('Cmd+Shift+K')).toBeTruthy();
    expect(screen.queryByText('Ctrl+Shift+K')).toBeNull();
    fireEvent.keyDown(window, { code: 'KeyK', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(window, { code: 'KeyK', metaKey: true, shiftKey: true });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('D12 전체 화면 알림을 받으면 신호등 여백을 없앨 수 있게 표시한다', async () => {
    const { api } = setup({}, 'mac');
    await flush();
    act(() => api.emit({ type: 'window.fullScreen', fullScreen: true }));
    expect(document.querySelector('.app')?.getAttribute('data-fullscreen')).toBe('true');
    act(() => api.emit({ type: 'window.fullScreen', fullScreen: false }));
    expect(document.querySelector('.app')?.getAttribute('data-fullscreen')).toBe('false');
  });

  it.each([
    ['mac', { code: 'KeyV', metaKey: true }],
    ['mac', { code: 'KeyC', metaKey: true }],
    ['mac', { code: 'KeyK', metaKey: true }],
    ['windows', { code: 'KeyV', ctrlKey: true, shiftKey: true }],
  ] as const)(
    'D12 %s 입력칸의 복사·붙여넣기 키는 터미널 전용 동작이 가로채지 않는다(보안 리뷰 M1)',
    async (platform, key) => {
      setup({}, platform);
      await flush();
      const field = screen.getByRole('combobox');
      field.focus();
      expect(fireEvent.keyDown(field, key)).toBe(true);
    },
  );

  it('DESIGN §2.8 헤더에 로고와 앱 이름을 보여 준다(로고는 장식이라 읽지 않는다)', () => {
    setup();
    const header = screen.getByRole('banner');
    const logo = header.querySelector('svg.brand-logo');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    expect(header.textContent).toContain('btterm');
  });

  it('F1.3 빠른 연결은 user@host:port를 해석하고, 잘못된 입력은 알린다', async () => {
    const { api } = setup();
    await quickConnect('btterm@127.0.0.1:2222');
    expect(api.requestsOf('session.openQuick')).toEqual([
      { type: 'session.openQuick', host: '127.0.0.1', port: 2222, username: 'btterm' },
    ]);
    expect(screen.getByRole('tab', { name: /btterm@127\.0\.0\.1/ })).toBeTruthy();

    await quickConnect('nouser');
    expect(screen.getByRole('alert').textContent).toContain('user@host');
  });

  describe('빠른 연결 = 서버 검색 (F5.1, UX 검토 U3)', () => {
    const input = () => screen.getByRole('combobox', { name: '빠른 연결' });
    const options = () =>
      within(screen.getByRole('listbox', { name: '저장된 서버' }))
        .getAllByRole('option')
        .map((o) => o.textContent);

    it('이름 일부를 치면 저장된 서버를 보여 주고 Enter로 첫 서버에 접속한다', async () => {
      const { api } = setup();
      await flush();
      fireEvent.change(input(), { target: { value: 'db' } });
      expect(options()).toEqual(['db-0110.0.0.9']);
      fireEvent.keyDown(input(), { key: 'Enter' });
      fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
      await flush();
      expect(api.requestsOf('session.openProfile')).toEqual([
        { type: 'session.openProfile', profileId: 'p2' },
      ]);
      expect(api.requestsOf('session.openQuick')).toEqual([]);
    });

    it('↓로 고른 서버에 접속하고, Esc는 목록을 닫는다', async () => {
      const { api } = setup();
      await flush();
      input().focus();
      fireEvent.change(input(), { target: { value: '01' } });
      expect(options()).toEqual(['db-0110.0.0.9', 'web-0110.0.0.5']);
      // 여러 서버가 맞으면 저절로 고르지 않는다
      expect(input().getAttribute('aria-activedescendant')).toBeNull();
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      expect(input().getAttribute('aria-activedescendant')).toBe('quick-option-p1');
      fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
      await flush();
      expect(api.requestsOf('session.openProfile')).toEqual([
        { type: 'session.openProfile', profileId: 'p1' },
      ]);

      fireEvent.change(input(), { target: { value: 'web' } });
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('주소 일부나 사용자명만 치고 Enter를 누르면 비슷한 서버로 접속하지 않는다(리뷰 1)', async () => {
      const { api } = setup();
      await flush();
      fireEvent.change(input(), { target: { value: '10.0.0.' } });
      fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
      await flush();
      fireEvent.change(input(), { target: { value: 'wb' } });
      fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
      await flush();
      expect(api.requestsOf('session.openProfile')).toEqual([]);
      expect(screen.getByRole('alert').textContent).toContain('user@host');
      expect(screen.queryByRole('listbox')).toBeNull();

      // 이름·주소가 정확히 같으면 그 서버
      fireEvent.change(input(), { target: { value: '10.0.0.5' } });
      fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
      await flush();
      expect(api.requestsOf('session.openProfile')).toEqual([
        { type: 'session.openProfile', profileId: 'p1' },
      ]);
    });

    it('Esc로 닫은 뒤 Ctrl+Shift+K를 다시 누르면 목록이 열린다(리뷰 6)', async () => {
      setup();
      await flush();
      fireEvent.keyDown(window, { code: 'KeyK', ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
      fireEvent.keyDown(window, { code: 'KeyK', ctrlKey: true, shiftKey: true });
      expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('맞는 서버가 없으면 user@host로 접속한다', async () => {
      const { api } = setup();
      await flush();
      fireEvent.change(input(), { target: { value: 'root@10.9.9.9:2200' } });
      expect(screen.queryByRole('listbox')).toBeNull();
      fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
      await flush();
      expect(api.requestsOf('session.openQuick')).toEqual([
        { type: 'session.openQuick', host: '10.9.9.9', port: 2200, username: 'root' },
      ]);
    });

    it('새 탭(+, Ctrl+Shift+T)은 서버 목록을 연다', async () => {
      setup();
      await flush();
      fireEvent.keyDown(window, { code: 'KeyT', ctrlKey: true, shiftKey: true });
      expect(document.activeElement).toBe(input());
      expect(options()).toEqual(['db-0110.0.0.9', 'web-0110.0.0.5']);
    });

    it('연결이 없을 때 첫 화면에서 서버 추가·빠른 연결로 바로 간다', async () => {
      setup();
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '새 서버 추가' }));
      expect(screen.getByRole('dialog', { name: '새 서버' })).toBeTruthy();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /빠른 연결 \(Ctrl\+Shift\+K\)/ }));
      expect(document.activeElement).toBe(input());
    });
  });

  it('서버 목록을 검색하고 더블클릭으로 접속한다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.change(screen.getByRole('searchbox', { name: '서버 검색' }), {
      target: { value: 'db' },
    });
    expect(screen.queryByText('web-01')).toBeNull();
    fireEvent.doubleClick(screen.getByText('db-01'));
    await flush();
    expect(api.requestsOf('session.openProfile')).toEqual([
      { type: 'session.openProfile', profileId: 'p2' },
    ]);
    expect(screen.getByRole('tab', { name: /db-01/ })).toBeTruthy();
  });

  describe('대화상자 공통 동작 (UX5)', () => {
    const passwordPrompt = (api: FakeBtTermApi) =>
      act(() =>
        api.emit({
          type: 'prompt.request',
          promptId: 'pw',
          prompt: { kind: 'password', host: 'h1', username: 'a' },
        }),
      );
    const inTerminal = () => document.activeElement?.closest('.terminal-host') !== null;

    it('비밀번호 창은 어디서든 Esc로 취소되고, 닫히면 터미널로 포커스가 돌아온다', async () => {
      const { api } = setup();
      await quickConnect('a@h1');
      expect(inTerminal()).toBe(true);
      passwordPrompt(api);
      const dialog = screen.getByRole('dialog', { name: '비밀번호 입력' });
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.contains(document.activeElement)).toBe(true);
      (document.activeElement as HTMLElement).blur();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await flush();
      expect(api.requestsOf('prompt.respond')).toEqual([
        { type: 'prompt.respond', promptId: 'pw', response: { kind: 'cancel' } },
      ]);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(inTerminal()).toBe(true);
    });

    it('Tab은 대화상자 안에서만 돌고, 열려 있는 동안 앱 단축키는 동작하지 않는다', async () => {
      const { api } = setup();
      await quickConnect('a@h1');
      passwordPrompt(api);
      const dialog = screen.getByRole('dialog', { name: '비밀번호 입력' });
      const cancel = within(dialog).getByRole('button', { name: '취소' });
      cancel.focus();
      fireEvent.keyDown(cancel, { key: 'Tab' });
      expect(document.activeElement).toBe(dialog.querySelector('input'));
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(cancel);

      fireEvent.keyDown(window, { code: 'KeyW', ctrlKey: true, shiftKey: true });
      expect(screen.getAllByRole('tab')).toHaveLength(1);
    });

    it('아래 대화상자가 먼저 닫혀도 위 대화상자의 inert·포커스는 유지된다(리뷰 M1)', async () => {
      const { api } = setup();
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '새 서버 추가' }));
      const host = screen.getByRole('dialog', { name: '새 서버' });
      passwordPrompt(api);
      const prompt = screen.getByRole('dialog', { name: '비밀번호 입력' });
      expect(prompt.contains(document.activeElement)).toBe(true);
      fireEvent.click(within(host).getByRole('button', { name: '취소' }));
      await flush();
      expect(screen.queryByRole('dialog', { name: '새 서버' })).toBeNull();
      expect(prompt.contains(document.activeElement)).toBe(true);
      expect((document.querySelector('.header') as HTMLElement).inert).toBe(true);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await flush();
      expect((document.querySelector('.header') as HTMLElement).inert).toBe(false);
    });

    it('한글 조합 중 Esc는 대화상자를 닫지 않는다', async () => {
      const { api } = setup();
      await quickConnect('a@h1');
      passwordPrompt(api);
      fireEvent.keyDown(document.activeElement!, { key: 'Escape', isComposing: true });
      expect(screen.getByRole('dialog', { name: '비밀번호 입력' })).toBeTruthy();
    });

    it('대화상자는 제목줄을 끌어 옮기고, 화면 밖으로는 나가지 않으며, 다시 열면 가운데로', async () => {
      setup();
      await flush();
      const open = () => {
        fireEvent.click(screen.getByRole('button', { name: '새 서버 추가' }));
        const dialog = screen.getByRole('dialog', { name: '새 서버' });
        dialog.getBoundingClientRect = () =>
          ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }) as DOMRect;
        return dialog;
      };
      const dialog = open();
      const title = within(dialog).getByRole('heading', { name: '새 서버' });
      fireEvent.mouseDown(title, { button: 0, clientX: 200, clientY: 120 });
      fireEvent.mouseMove(document, { clientX: 260, clientY: 150 });
      expect(dialog.style.translate).toBe('60px 30px');
      fireEvent.mouseMove(document, { clientX: 5000, clientY: 5000 });
      expect(dialog.style.translate).toBe(
        `${window.innerWidth - 500}px ${window.innerHeight - 400}px`,
      );
      fireEvent.mouseUp(document);
      fireEvent.mouseMove(document, { clientX: 0, clientY: 0 });
      expect(dialog.style.translate).toBe(
        `${window.innerWidth - 500}px ${window.innerHeight - 400}px`,
      );

      fireEvent.keyDown(document.body, { key: 'Escape' });
      await flush();
      expect(open().style.translate).toBe('');
    });

    it('DF1 확인창은 그 세션의 탭을 닫거나 main이 취소하면 사라진다', async () => {
      const { api } = setup();
      await quickConnect('a@h1');
      const hostKey = (promptId: string) =>
        act(() =>
          api.emit({
            type: 'prompt.request',
            promptId,
            sessionId: 's1',
            prompt: {
              kind: 'hostKey',
              verdict: 'unknown',
              host: 'h1',
              port: 22,
              keyType: 'ssh-ed25519',
              fingerprint: 'SHA256:x',
            },
          }),
        );
      hostKey('hk1');
      expect(screen.getByRole('alertdialog')).toBeTruthy();
      act(() => api.emit({ type: 'prompt.cancelled', promptId: 'hk1' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();

      hostKey('hk2');
      fireEvent.click(screen.getByRole('button', { name: 'a@h1 탭 닫기', hidden: true }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      // main이 세션 종료로 취소하므로 화면이 따로 답하지 않는다
      expect(api.requestsOf('prompt.respond')).toEqual([]);
    });

    it('TR6 키 불일치 창은 차단만 하고, 연결을 취소하며 알려진 호스트 관리를 연다', async () => {
      const { api } = setup();
      api.on('knownHosts.list', () => ({ entries: [] }));
      act(() =>
        api.emit({
          type: 'prompt.request',
          promptId: 'hk',
          prompt: {
            kind: 'hostKey',
            verdict: 'mismatch',
            host: 'h1',
            port: 22,
            keyType: 'ssh-ed25519',
            fingerprint: 'SHA256:new',
            knownFingerprints: ['SHA256:old'],
          },
        }),
      );
      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).queryByRole('button', { name: /저장|이번만/ })).toBeNull();
      expect(dialog.textContent).toContain('ssh-keygen -R "h1"');
      fireEvent.click(within(dialog).getByRole('button', { name: '알려진 호스트 관리' }));
      await flush();
      expect(api.requestsOf('prompt.respond')[0]?.response).toEqual({
        kind: 'hostKey',
        decision: 'reject',
      });
      expect(screen.getByRole('dialog', { name: '알려진 호스트' })).toBeTruthy();
    });

    it('SEC-3 AC10 다른 종류의 키만 알려진 호스트가 새 종류를 내밀면 종류가 다르다고 알리고 차단만 한다', async () => {
      const { api } = setup();
      act(() =>
        api.emit({
          type: 'prompt.request',
          promptId: 'hk',
          prompt: {
            kind: 'hostKey',
            verdict: 'mismatch',
            mismatchReason: 'other-type-known',
            host: 'h1',
            port: 22,
            keyType: 'ssh-rsa',
            fingerprint: 'SHA256:new',
            knownFingerprints: ['SHA256:old'],
            knownKeyTypes: ['ssh-ed25519'],
          },
        }),
      );
      const dialog = screen.getByRole('alertdialog', { name: '호스트 키 종류가 다릅니다' });
      expect(dialog.textContent).toContain('ssh-ed25519');
      expect(dialog.textContent).toContain('ssh-rsa SHA256:new');
      expect(dialog.textContent).toContain('SHA256:old');
      expect(within(dialog).queryByRole('button', { name: /저장|이번만/ })).toBeNull();
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: '연결 취소' }),
      );
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await flush();
      expect(api.requestsOf('prompt.respond')[0]?.response).toEqual({
        kind: 'hostKey',
        decision: 'reject',
      });
    });

    it('TR6 보안 리뷰 L-4: 셸 특수문자가 든 호스트는 복사용 명령을 보여 주지 않는다', () => {
      const { api } = setup();
      act(() =>
        api.emit({
          type: 'prompt.request',
          promptId: 'hk',
          prompt: {
            kind: 'hostKey',
            verdict: 'mismatch',
            host: 'h1;rm -rf ~',
            port: 22,
            keyType: 'ssh-ed25519',
            fingerprint: 'SHA256:new',
            knownFingerprints: ['SHA256:old'],
          },
        }),
      );
      expect(screen.getByRole('alertdialog').textContent).not.toContain('ssh-keygen');
    });

    it('호스트 키 창의 Esc는 연결 취소', async () => {
      const { api } = setup();
      act(() =>
        api.emit({
          type: 'prompt.request',
          promptId: 'hk',
          prompt: {
            kind: 'hostKey',
            verdict: 'unknown',
            host: 'h1',
            port: 22,
            keyType: 'ssh-ed25519',
            fingerprint: 'SHA256:x',
          },
        }),
      );
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await flush();
      expect(api.requestsOf('prompt.respond')[0]?.response).toEqual({
        kind: 'hostKey',
        decision: 'reject',
      });
    });
  });

  it('UX6 성공 알림은 4초 뒤 사라지고, 오류 알림은 닫을 때까지 남는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api } = setup();
      api.on('profiles.saveProfile', () => ({ ok: true }));
      await quickConnect('a@h1');
      act(() => api.emit({ type: 'session.state', sessionId: 's1', state: 'ready' }));
      fireEvent.click(screen.getByRole('button', { name: '저장' }));
      await flush();
      expect(screen.getByText('서버 목록에 저장했습니다')).toBeTruthy();
      act(() => void vi.advanceTimersByTime(4100));
      expect(screen.queryByText('서버 목록에 저장했습니다')).toBeNull();

      api.on('session.openQuick', () => ({ sessionId: null, error: 'refused' }));
      await quickConnect('b@h2');
      expect(screen.getByRole('alert').textContent).toContain('서버가 연결을 거부했습니다');
      act(() => void vi.advanceTimersByTime(10_000));
      expect(screen.getByRole('alert')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('UX6 연결·인증 중에는 칸 가운데 안내와 취소 버튼을 보여 준다', async () => {
    const { api } = setup();
    await quickConnect('a@h1');
    expect(screen.getByText('a@h1에 연결하는 중…')).toBeTruthy();
    act(() => api.emit({ type: 'session.state', sessionId: 's1', state: 'authenticating' }));
    expect(screen.getByText('a@h1에 인증하는 중…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '연결 취소' }));
    await flush();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);

    await quickConnect('b@h2');
    act(() => api.emit({ type: 'session.state', sessionId: 's2', state: 'ready' }));
    expect(screen.queryByText(/연결하는 중|인증하는 중/)).toBeNull();
  });

  it('UX5 탭을 키보드로 닫으면 남은 탭의 터미널로, 마지막 탭이면 빠른 연결 칸으로 포커스가 간다', async () => {
    setup();
    await quickConnect('a@h1');
    await quickConnect('b@h2');
    const tab = screen.getByRole('tab', { name: /b@h2/ });
    tab.focus();
    fireEvent.keyDown(tab, { key: 'Delete' });
    await flush();
    expect(document.activeElement?.closest('.terminal-host')?.id).toBe('panel-s1');

    const last = screen.getByRole('tab', { name: /a@h1/ });
    last.focus();
    fireEvent.keyDown(last, { key: 'Delete' });
    await flush();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: '빠른 연결' }));
  });

  describe('화면 모드 (F5.3)', () => {
    const mockSystem = (light: boolean) => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: light,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as typeof window.matchMedia;
    };
    const theme = () => document.documentElement.dataset.theme;

    it('기본은 시스템 설정을 따른다', async () => {
      mockSystem(true);
      setup();
      await flush();
      expect(theme()).toBe('light');
    });

    it('디자인 탭에서 라이트·다크를 고르면 바로 바뀌고 설정에 남는다', async () => {
      mockSystem(false);
      const { api } = setup();
      await flush();
      expect(theme()).toBe('dark');
      fireEvent.keyDown(window, { code: 'KeyL', ctrlKey: true, shiftKey: true });
      const mode = screen.getByRole('radiogroup', { name: '화면 모드' });
      fireEvent.click(within(mode).getByRole('radio', { name: '라이트' }));
      await flush();
      expect(theme()).toBe('light');
      expect(api.requestsOf('settings.update').at(-1)).toEqual({
        type: 'settings.update',
        patch: { ui: { theme: 'light' } },
      });
      expect(within(mode).getByRole('radio', { name: '라이트' }).getAttribute('aria-checked')).toBe(
        'true',
      );
    });
  });

  describe('재시작 시 탭 복원 (F6.9, DF8)', () => {
    const lastSession = {
      kind: 'split' as const,
      axis: 'row' as const,
      children: [
        { kind: 'group' as const, tabs: [{ quick: { host: 'h1', port: 22, username: 'a' } }] },
        { kind: 'group' as const, tabs: [{ profileId: 'p1' }] },
      ],
    };
    /** 칸 배치 저장은 300ms 모아서 한다 */
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    const savedSessions = (api: ReturnType<typeof setup>['api']) =>
      api.requestsOf('settings.update').filter((r) => 'lastSession' in r.patch);

    it('지난번 탭이 있으면 빈 칸에 다시 열기 버튼, 누르면 칸 배치대로 연다', async () => {
      const { api } = setup({ lastSession });
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '이전 탭 2개 다시 열기' }));
      await flush();
      await flush();
      expect(api.requestsOf('session.openQuick')).toEqual([
        { type: 'session.openQuick', host: 'h1', port: 22, username: 'a' },
      ]);
      expect(api.requestsOf('session.openProfile')).toEqual([
        { type: 'session.openProfile', profileId: 'p1' },
      ]);
      const bars = screen.getAllByRole('tablist');
      expect(
        bars.map((bar) =>
          within(bar)
            .getAllByRole('tab')
            .map((t) => t.textContent),
        ),
      ).toEqual([['a@h1'], ['web-01']]);
      expect(screen.queryByRole('button', { name: /이전 탭/ })).toBeNull();
    });

    it('시작 직후에는 지난번 기록을 덮지 않고, 탭을 열고 닫으면 그때그때 저장한다', async () => {
      const { api } = setup({ lastSession });
      await settle();
      expect(savedSessions(api)).toEqual([]);

      await quickConnect('b@h2');
      await settle();
      expect(savedSessions(api).at(-1)?.patch.lastSession).toEqual({
        kind: 'group',
        tabs: [{ quick: { host: 'h2', port: 22, username: 'b' } }],
      });
      expect(screen.queryByRole('button', { name: /이전 탭/ })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'b@h2 탭 닫기' }));
      await settle();
      expect(savedSessions(api).at(-1)?.patch.lastSession).toBeNull();
    });
  });

  describe('스니펫 (F3.14 1단계, DF7)', () => {
    async function openSnippets() {
      const env = setup();
      await quickConnect('a@h1');
      act(() => env.api.emit({ type: 'session.state', sessionId: 's1', state: 'ready' }));
      fireEvent.keyDown(window, { code: 'KeyL', ctrlKey: true, shiftKey: true });
      fireEvent.click(screen.getByRole('tab', { name: '스니펫' }));
      return env;
    }

    async function addSnippet(name: string, command: string) {
      fireEvent.click(screen.getByRole('button', { name: '새 스니펫' }));
      fireEvent.change(screen.getByRole('textbox', { name: '스니펫 이름' }), {
        target: { value: name },
      });
      fireEvent.change(screen.getByRole('textbox', { name: '스니펫 명령' }), {
        target: { value: command },
      });
      fireEvent.click(screen.getByRole('button', { name: '스니펫 저장' }));
      await flush();
    }

    it('새 스니펫을 설정에 저장하고, 실행하면 프롬프트에 입력한 뒤 Enter', async () => {
      const { api, engines } = await openSnippets();
      await addSnippet('disk', 'df -h');
      expect(api.requestsOf('settings.update').at(-1)?.patch.snippets).toEqual([
        { id: expect.any(String), name: 'disk', command: 'df -h' },
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'disk 실행' }));
      expect(engines[0]?.pasted).toEqual(['df -h']);
      expect(api.written.get('s1')?.at(-1)).toBe('\r');
    });

    it('{{변수}}가 있으면 값을 물은 뒤 입력만 한다(Enter 없음)', async () => {
      const { api, engines } = await openSnippets();
      await addSnippet('tail', 'tail -n {{lines}} app.log');
      fireEvent.click(screen.getByRole('button', { name: 'tail 입력만' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'lines' }), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: '변수 채워 넣기' }));
      expect(engines[0]?.pasted).toEqual(['tail -n 50 app.log']);
      expect(api.written.get('s1') ?? []).not.toContain('\r');
    });

    it('삭제하면 목록에서 빠지고 설정에 남는다', async () => {
      const { api } = await openSnippets();
      await addSnippet('disk', 'df -h');
      fireEvent.click(screen.getByRole('button', { name: 'disk 삭제' }));
      await flush();
      expect(api.requestsOf('settings.update').at(-1)?.patch.snippets).toEqual([]);
      expect(screen.queryByRole('button', { name: 'disk 실행' })).toBeNull();
    });
  });

  describe('명령 팔레트 (F5.1b, DF6)', () => {
    const openPalette = () =>
      fireEvent.keyDown(window, { code: 'KeyP', ctrlKey: true, shiftKey: true });
    const input = () => screen.getByRole('combobox', { name: '명령 팔레트' });
    const options = () => screen.getAllByRole('option').map((o) => o.textContent);

    it('Ctrl+Shift+P로 열고, 동작을 찾아 Enter로 실행한다. 단축키도 보인다', async () => {
      setup();
      await flush();
      openPalette();
      fireEvent.change(input(), { target: { value: '사이드바' } });
      expect(options()[0]).toBe('사이드바 열기·닫기Ctrl+Shift+B');
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(screen.queryByRole('dialog', { name: '명령 팔레트' })).toBeNull();
      await flush(); // 팔레트가 닫히고 포커스가 돌아온 뒤 실행
      expect(screen.queryByRole('complementary', { name: '서버 목록' })).toBeNull();
    });

    it('#는 열린 탭만, ↓로 고르고 Enter면 그 탭으로 간다', async () => {
      setup();
      await quickConnect('a@h1');
      await quickConnect('b@h2');
      openPalette();
      fireEvent.change(input(), { target: { value: '#' } });
      expect(options()).toEqual(['a@h1', 'b@h2']);
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      fireEvent.keyDown(input(), { key: 'ArrowUp' });
      fireEvent.keyDown(input(), { key: 'Enter' });
      await flush();
      expect(screen.getByRole('tab', { name: /a@h1/ }).getAttribute('aria-selected')).toBe('true');
    });

    it('>는 동작만, 화면 모드 같은 팔레트 전용 동작도 있다. Esc로 닫는다', async () => {
      const { api } = setup();
      await flush();
      openPalette();
      fireEvent.change(input(), { target: { value: '>라이트' } });
      expect(options()).toEqual(['화면 모드: 라이트']);
      fireEvent.keyDown(input(), { key: 'Enter' });
      await flush();
      expect(api.requestsOf('settings.update').at(-1)?.patch.ui).toEqual({ theme: 'light' });

      openPalette();
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: '명령 팔레트' })).toBeNull();
    });
  });

  describe('탭 이름 바꾸기 (F3.1b, DF3)', () => {
    const editor = () => screen.getByRole('textbox', { name: '탭 이름' });

    it('더블클릭하면 그 자리에서 고치고 Enter로 확정한다. 툴팁에는 원래 이름', async () => {
      setup();
      await quickConnect('a@h1');
      fireEvent.doubleClick(screen.getByRole('tab', { name: /a@h1/ }));
      expect((editor() as HTMLInputElement).value).toBe('a@h1');
      fireEvent.change(editor(), { target: { value: 'build' } });
      fireEvent.keyDown(editor(), { key: 'Enter' });
      const tab = screen.getByRole('tab', { name: /^build/ });
      expect(tab.getAttribute('title')).toBe('a@h1');
    });

    it('Esc는 취소, 빈 이름은 원래 이름으로', async () => {
      setup();
      await quickConnect('a@h1');
      fireEvent.keyDown(screen.getByRole('tab', { name: /a@h1/ }), { key: 'F2' });
      fireEvent.change(editor(), { target: { value: 'logs' } });
      fireEvent.keyDown(editor(), { key: 'Escape' });
      expect(screen.getByRole('tab', { name: /^a@h1/ })).toBeTruthy();

      fireEvent.contextMenu(screen.getByRole('tab', { name: /a@h1/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
      fireEvent.change(editor(), { target: { value: 'logs' } });
      fireEvent.blur(editor());
      expect(screen.getByRole('tab', { name: /^logs/ })).toBeTruthy();

      fireEvent.doubleClick(screen.getByRole('tab', { name: /logs/ }));
      fireEvent.change(editor(), { target: { value: '  ' } });
      fireEvent.keyDown(editor(), { key: 'Enter' });
      expect(screen.getByRole('tab', { name: /^a@h1/ })).toBeTruthy();
    });
  });

  it('AC13 탭 닫기 버튼은 세션을 닫고 터미널 엔진을 정리한다', async () => {
    const { api, engines } = setup();
    await quickConnect('a@h1');
    await quickConnect('b@h2');
    fireEvent.click(screen.getByRole('button', { name: 'b@h2 탭 닫기' }));
    await flush();
    expect(api.requestsOf('session.close')).toEqual([{ type: 'session.close', sessionId: 's2' }]);
    expect(engines[1]?.disposed).toBe(true);
    expect(engines[0]?.disposed).toBe(false);
    expect(screen.getByRole('tab', { name: /a@h1/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('Ctrl+Shift+B는 사이드바를, Ctrl+Shift+L은 도구 패널을 토글하고 설정에 남긴다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('complementary', { name: '서버 목록' })).toBeNull();
    fireEvent.keyDown(window, { code: 'KeyL', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('complementary', { name: '터미널 도구 패널' })).toBeTruthy();
    await flush();
    expect(api.requestsOf('settings.update').at(-1)?.patch.ui).toMatchObject({
      sidebarOpen: false,
      toolPanel: 'design',
    });
  });

  it('UX8 도구 패널은 탭바의 [+] 옆 버튼으로 열고 닫으며, 활성 칸 안 오른쪽에 열린다', async () => {
    setup();
    await quickConnect('a@h1');
    const activity = screen.getByRole('navigation', { name: '작업 영역' });
    expect(within(activity).getAllByRole('button')).toHaveLength(2);
    expect(document.querySelector('.panel-handle')).toBeNull();

    const toggle = screen.getByRole('button', { name: '도구 패널 열기·닫기' });
    expect(toggle.closest('.tabbar')).not.toBeNull();
    expect(toggle.previousElementSibling?.getAttribute('aria-label')).toMatch(/^새 연결/);
    fireEvent.click(toggle);
    const panel = screen.getByRole('complementary', { name: '터미널 도구 패널' });
    expect(panel.closest('.pane-group')?.getAttribute('data-focused')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.queryByRole('complementary', { name: '터미널 도구 패널' })).toBeNull();
  });

  it('F3.16 디자인 탭: 적용 범위는 화면 모드가 아니라 "터미널" 묶음에만 걸린다', async () => {
    setup();
    await quickConnect('a@h1');
    fireEvent.keyDown(window, { code: 'KeyL', ctrlKey: true, shiftKey: true });
    const terminal = screen.getByRole('region', { name: '터미널' });
    expect(within(terminal).getByRole('radio', { name: '이 탭만' })).toBeTruthy();
    expect(within(terminal).queryByRole('radio', { name: '라이트' })).toBeNull();
    expect(screen.getByRole('radio', { name: '라이트' })).toBeTruthy();
  });

  it('F3.16 디자인 탭: 전체 기본값은 설정에 저장, 이 탭만은 현재 터미널에만', async () => {
    const { api, engines } = setup();
    await quickConnect('a@h1');
    fireEvent.keyDown(window, { code: 'KeyL', ctrlKey: true, shiftKey: true });
    const panel = screen.getByRole('complementary', { name: '터미널 도구 패널' });

    fireEvent.click(within(panel).getByRole('radio', { name: /One Dark/ }));
    await flush();
    expect(
      api.requestsOf('settings.update').some((r) => r.patch.terminal?.themeId === 'one-dark'),
    ).toBe(true);
    expect(engines[0]?.options?.theme.background).toBe('#282C34');

    fireEvent.click(within(panel).getByRole('radio', { name: '이 탭만' }));
    fireEvent.click(within(panel).getByRole('button', { name: '글꼴 크게' }));
    expect(engines[0]?.options?.fontSize).toBe(14);
    expect(api.requestsOf('settings.update').some((r) => r.patch.terminal?.fontSize)).toBe(false);
  });

  it('F3.17a 명령 기록: 검색 후 Enter는 프롬프트에 입력만 한다', async () => {
    const { api, engines } = setup();
    await quickConnect('a@h1');
    act(() => api.emit({ type: 'session.state', sessionId: 's1', state: 'ready' }));
    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true, shiftKey: true });
    await flush();
    const search = screen.getByRole('searchbox', { name: '명령 기록 검색' });
    fireEvent.change(search, { target: { value: 'dock' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['docker ps -a']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(engines[0]?.pasted).toEqual(['docker ps -a']);
  });

  it('F3.9 여러 줄 붙여넣기는 확인창을 거친다', async () => {
    const { api, engines } = setup();
    api.on('clipboard.readText', () => ({ text: 'ls\npwd' }));
    await quickConnect('a@h1');
    const engine = engines[0]!;
    act(() => {
      engine.key(new KeyboardEvent('keydown', { code: 'KeyV', ctrlKey: true, shiftKey: true }));
    });
    await flush();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('2줄');
    fireEvent.click(within(dialog).getByRole('button', { name: '붙여넣기' }));
    await flush();
    expect(engine.pasted).toEqual(['ls\npwd']);
  });

  it('SEC-6 링크는 확인창에서 허락해야 연다', async () => {
    const { api, engines } = setup();
    await quickConnect('a@h1');
    act(() => engines[0]!.clickLink('https://example.com'));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '브라우저에서 열기' }));
    await flush();
    expect(api.requestsOf('link.open')).toEqual([
      { type: 'link.open', url: 'https://example.com' },
    ]);
  });

  it('재접속 대기 중이면 배너와 상태바에 남은 시간을 보여준다', async () => {
    const { api } = setup();
    await quickConnect('a@h1');
    act(() =>
      api.emit({
        type: 'session.state',
        sessionId: 's1',
        state: 'reconnecting',
        reconnect: { attempt: 2, nextDelayMs: 2000 },
      }),
    );
    expect(screen.getByText('연결이 끊겼습니다. 2초 뒤 다시 시도합니다(2번째)')).toBeTruthy();
    expect(screen.getByRole('contentinfo').textContent).toContain('2번째 재시도 · 2초 뒤');
    fireEvent.click(screen.getByRole('button', { name: '지금 다시 연결' }));
    expect(api.requestsOf('session.reconnect')).toEqual([
      { type: 'session.reconnect', sessionId: 's1' },
    ]);
  });

  it('서버가 연결을 끊으면 배너로 알리고, 터미널에서 Enter는 다시 연결·Esc는 탭 닫기', async () => {
    const { api, engines } = setup();
    await quickConnect('a@h1');
    act(() => api.emit({ type: 'session.state', sessionId: 's1', state: 'closed' }));
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('연결이 끊겼습니다');
    expect(banner.textContent).toContain('Enter 다시 연결 · Esc 탭 닫기');
    act(() => {
      engines[0]!.key(new KeyboardEvent('keydown', { code: 'Enter' }));
    });
    expect(api.requestsOf('session.reconnect')).toHaveLength(1);
    act(() => {
      engines[0]!.key(new KeyboardEvent('keydown', { code: 'Escape' }));
    });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  describe('탭 그룹 분할 (F3.10a)', () => {
    const dataTransfer = () => ({
      setData: () => undefined,
      getData: () => '',
      effectAllowed: 'move',
      dropEffect: 'move',
      types: ['application/x-btterm-tab'],
    });
    const panel = (id: string) => document.getElementById(`panel-${id}`)!;
    const bars = () => screen.getAllByRole('tablist');
    const barTabs = () =>
      bars().map((bar) =>
        within(bar)
          .queryAllByRole('tab')
          .map((t) => t.textContent),
      );
    const drag = (name: RegExp) =>
      fireEvent.dragStart(screen.getByRole('tab', { name }), { dataTransfer: dataTransfer() });

    /** 칸 터미널 위 (x, y)에 놓는다. 좌표는 200×100 기준이고 칸은 800×400으로 둔다. */
    function dropOnPane(index: number, clientX: number, clientY: number) {
      const zone = document.querySelectorAll<HTMLElement>('.drop-zone')[index]!;
      zone.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }) as DOMRect;
      // jsdom에는 DragEvent가 없어 좌표를 직접 붙인다.
      const at = (event: Event) =>
        Object.defineProperties(event, {
          clientX: { value: clientX * 4 },
          clientY: { value: clientY * 4 },
        });
      fireEvent(zone, at(createEvent.dragOver(zone, { dataTransfer: dataTransfer() })));
      const spot = zone.querySelector('.drop-preview')?.getAttribute('data-spot');
      fireEvent(zone, at(createEvent.drop(zone, { dataTransfer: dataTransfer() })));
      return spot;
    }

    async function twoTabs() {
      const env = setup();
      await quickConnect('a@h1');
      await quickConnect('b@h2');
      return env;
    }

    describe('칸 조작 (F3.10b, UX 검토 U4)', () => {
      const separator = () => screen.getByRole('separator');
      const groups = () => [...document.querySelectorAll('.pane-group')];

      async function twoPanes() {
        const env = await twoTabs();
        fireEvent.contextMenu(screen.getByRole('tab', { name: /b@h2/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: '오른쪽으로 분할' }));
        return env;
      }

      it('칸 경계는 키보드로 5%씩 옮기고 칸 크기에 반영된다', async () => {
        await twoPanes();
        expect(separator().getAttribute('aria-valuenow')).toBe('50');
        fireEvent.keyDown(separator(), { key: 'ArrowRight' });
        expect(separator().getAttribute('aria-valuenow')).toBe('55');
        expect((groups()[0] as HTMLElement).style.flexGrow).toBe('0.55');
      });

      it('UX8 다른 칸 탭바의 도구 패널 버튼을 누르면 그 칸이 활성이 되고 패널이 그 칸으로 옮겨 열린다', async () => {
        await twoPanes();
        const handles = () => screen.getAllByRole('button', { name: '도구 패널 열기·닫기' });
        expect(handles()).toHaveLength(2);
        expect(handles().map((b) => b.closest('.pane-group'))).toEqual(groups());
        expect(handles().every((b) => b.closest('.tabbar'))).toBe(true);
        fireEvent.click(handles()[1]!);
        expect(
          screen.getByRole('complementary', { name: '터미널 도구 패널' }).closest('.pane-group'),
        ).toBe(groups()[1]);

        fireEvent.click(handles()[0]!);
        expect(groups()[0]!.getAttribute('data-focused')).toBe('true');
        expect(screen.getAllByRole('complementary', { name: '터미널 도구 패널' })).toHaveLength(1);
        expect(
          screen.getByRole('complementary', { name: '터미널 도구 패널' }).closest('.pane-group'),
        ).toBe(groups()[0]);
        expect(handles()[0]!.getAttribute('aria-expanded')).toBe('true');
        expect(handles()[1]!.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(handles()[0]!);
        expect(screen.queryByRole('complementary', { name: '터미널 도구 패널' })).toBeNull();
      });

      it('Ctrl+Alt+방향키는 칸이 둘 이상일 때만 이웃 칸으로 포커스를 옮긴다', async () => {
        await twoTabs();
        const one = new KeyboardEvent('keydown', {
          code: 'ArrowLeft',
          ctrlKey: true,
          altKey: true,
          cancelable: true,
        });
        window.dispatchEvent(one);
        expect(one.defaultPrevented).toBe(false);

        fireEvent.contextMenu(screen.getByRole('tab', { name: /b@h2/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: '오른쪽으로 분할' }));
        expect(screen.getByRole('tab', { name: /b@h2/ }).getAttribute('aria-selected')).toBe(
          'true',
        );
        fireEvent.keyDown(window, { code: 'ArrowLeft', ctrlKey: true, altKey: true });
        expect(groups()[0]!.getAttribute('data-focused')).toBe('true');
      });

      it('Ctrl+Shift+2는 활성 칸의 두 번째 탭으로 간다', async () => {
        await twoTabs();
        fireEvent.keyDown(window, { code: 'Digit1', ctrlKey: true, shiftKey: true });
        expect(screen.getByRole('tab', { name: /a@h1/ }).getAttribute('aria-selected')).toBe(
          'true',
        );
        fireEvent.keyDown(window, { code: 'Digit2', ctrlKey: true, shiftKey: true });
        expect(screen.getByRole('tab', { name: /b@h2/ }).getAttribute('aria-selected')).toBe(
          'true',
        );
      });

      it('Ctrl+Shift+D와 탭 메뉴로 같은 서버를 옆 칸에 연다(탭이 하나여도)', async () => {
        const { api } = setup();
        await quickConnect('a@h1');
        fireEvent.contextMenu(screen.getByRole('tab', { name: /a@h1/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: '같은 서버를 아래에 열기' }));
        await flush();
        expect(api.requestsOf('session.openQuick')).toHaveLength(2);
        expect(groups()).toHaveLength(2);
        expect(document.querySelector('.split')?.getAttribute('data-axis')).toBe('column');

        fireEvent.keyDown(window, { code: 'KeyD', ctrlKey: true, shiftKey: true });
        await flush();
        expect(api.requestsOf('session.openQuick')[2]).toEqual({
          type: 'session.openQuick',
          host: 'h1',
          port: 22,
          username: 'a',
        });
        expect(groups()).toHaveLength(3);
      });
    });

    it('탭이 하나면 끌 수 없다', async () => {
      setup();
      await quickConnect('a@h1');
      expect(screen.getByRole('tab', { name: /a@h1/ }).getAttribute('draggable')).toBe('false');
    });

    it('AC33 탭을 오른쪽 가장자리에 놓으면 칸이 둘로 나뉘고 각 칸 위에 자기 탭바가 있다', async () => {
      const { engines } = await twoTabs();
      expect(barTabs()).toEqual([['a@h1', 'b@h2']]);
      drag(/a@h1/);
      expect(dropOnPane(0, 190, 50)).toBe('right');

      expect(barTabs()).toEqual([['b@h2'], ['a@h1']]);
      // 각 탭바 바로 아래가 그 탭의 터미널
      expect(bars()[1]!.closest('.pane-group')!.contains(panel('s1'))).toBe(true);
      expect(bars()[0]!.closest('.pane-group')!.contains(panel('s2'))).toBe(true);
      expect(panel('s1').dataset.visible).toBe('true');
      expect(panel('s2').dataset.visible).toBe('true');
      expect(panel('s1').dataset.active).toBe('true');
      expect(engines[0]?.gpu).toBe(true);
      expect(engines[1]?.gpu).toBe(true);
      expect(document.querySelector('.drop-zone')).toBeNull();

      // 다른 칸을 누르면 그 칸이 활성
      fireEvent.mouseDown(panel('s2'));
      expect(panel('s2').dataset.active).toBe('true');
      expect(bars()[0]!.closest('.tabbar')!.getAttribute('data-focused')).toBe('true');

      // 칸의 마지막 탭을 닫으면 칸이 사라진다
      fireEvent.click(screen.getByRole('button', { name: 'a@h1 탭 닫기' }));
      await flush();
      expect(barTabs()).toEqual([['b@h2']]);
    });

    it('AC33 좌우로 나뉜 오른쪽 칸을 다시 위아래로 나눈다(중첩 분할)', async () => {
      const { engines } = setup();
      for (const target of ['a@h1', 'b@h2', 'c@h3']) await quickConnect(target);
      drag(/c@h3/);
      dropOnPane(0, 190, 50);
      expect(barTabs()).toEqual([['a@h1', 'b@h2'], ['c@h3']]);
      // 왼쪽 칸의 b를 오른쪽 칸 아래 가장자리로
      drag(/b@h2/);
      expect(dropOnPane(1, 100, 95)).toBe('bottom');
      expect(barTabs()).toEqual([['a@h1'], ['c@h3'], ['b@h2']]);
      const outer = document.querySelector('.workspace > .split')!;
      expect(outer.getAttribute('data-axis')).toBe('row');
      const inner = outer.querySelector(':scope > .split')!;
      expect(inner.getAttribute('data-axis')).toBe('column');
      expect(inner.contains(panel('s3'))).toBe(true);
      expect(inner.contains(panel('s2'))).toBe(true);
      expect(inner.contains(panel('s1'))).toBe(false);

      // 감싸인 칸의 터미널도 새 자리에 그대로 붙어 있다(엔진을 새로 열지 않음)
      expect(engines).toHaveLength(3);
      for (const id of ['s1', 's2', 's3']) {
        expect(panel(id).querySelector('.terminal-surface')).not.toBeNull();
      }
      expect(engines.map((e) => e.opened)).toEqual([1, 1, 1]);

      // 묶음이 풀려도 남은 칸의 터미널은 그대로
      fireEvent.click(screen.getByRole('button', { name: 'b@h2 탭 닫기' }));
      await flush();
      expect(document.querySelector('.workspace .split .split')).toBeNull();
      expect(panel('s3').querySelector('.terminal-surface')).not.toBeNull();
      expect(engines[2]!.opened).toBe(1);
    });

    it('칸 가운데에 놓거나 다른 칸 탭바에 놓으면 그 칸으로 옮긴다', async () => {
      setup();
      for (const target of ['a@h1', 'b@h2', 'c@h3']) await quickConnect(target);
      drag(/a@h1/);
      dropOnPane(0, 190, 50);
      expect(barTabs()).toEqual([['b@h2', 'c@h3'], ['a@h1']]);

      drag(/b@h2/);
      expect(dropOnPane(1, 100, 50)).toBe('center');
      expect(barTabs()).toEqual([['c@h3'], ['a@h1', 'b@h2']]);

      drag(/c@h3/);
      const bar = bars()[1]!;
      fireEvent.dragOver(bar, { dataTransfer: dataTransfer() });
      fireEvent.drop(bar, { dataTransfer: dataTransfer() });
      expect(barTabs()).toEqual([['a@h1', 'b@h2', 'c@h3']]);
    });

    it('탭 우클릭 메뉴로 아래로 분할하고, 할 수 없는 분할은 숨기며, 칸을 합친다', async () => {
      await twoTabs();
      fireEvent.contextMenu(screen.getByRole('tab', { name: /a@h1/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: '아래로 분할' }));
      expect(barTabs()).toEqual([['b@h2'], ['a@h1']]);
      expect(document.querySelector('.split')?.getAttribute('data-axis')).toBe('column');

      // 탭 하나뿐인 칸은 자기 칸으로 옮겨 나눌 수 없다(같은 서버를 새로 열어 나누는 것은 된다)
      fireEvent.contextMenu(screen.getByRole('tab', { name: /a@h1/ }));
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
        '이름 바꾸기',
        '같은 서버를 오른쪽에 열기',
        '같은 서버를 아래에 열기',
        '칸 합치기',
      ]);
      fireEvent.click(screen.getByRole('menuitem', { name: '칸 합치기' }));
      expect(barTabs()).toEqual([['b@h2', 'a@h1']]);
    });

    it('탭이 하나여도 끌기 상태가 남으면 다음 클릭에서 풀려 토스트를 누를 수 있다', async () => {
      const { api } = setup();
      await quickConnect('a@h1');
      act(() => api.emit({ type: 'session.state', sessionId: 's1', state: 'ready' }));
      fireEvent.dragStart(screen.getByRole('tab', { name: /a@h1/ }), {
        dataTransfer: dataTransfer(),
      });
      expect(document.querySelector('.toast')!.getAttribute('data-passthrough')).toBe('true');
      fireEvent.mouseDown(document.body);
      expect(document.querySelector('.toast')!.getAttribute('data-passthrough')).toBe('false');
    });

    it('탭을 끄는 동안 저장 토스트는 놓기를 가로막지 않는다', async () => {
      const { api } = await twoTabs();
      act(() => api.emit({ type: 'session.state', sessionId: 's2', state: 'ready' }));
      const toast = document.querySelector('.toast')!;
      expect(toast.getAttribute('data-passthrough')).toBe('false');
      drag(/a@h1/);
      expect(toast.getAttribute('data-passthrough')).toBe('true');
      fireEvent.dragEnd(screen.getByRole('tab', { name: /a@h1/ }));
      expect(toast.getAttribute('data-passthrough')).toBe('false');
    });

    it('끌기를 취소하거나 놓기 영역이 남으면 다음 클릭에서 사라진다', async () => {
      await twoTabs();
      const tab = screen.getByRole('tab', { name: /a@h1/ });
      fireEvent.dragStart(tab, { dataTransfer: dataTransfer() });
      expect(document.querySelector('.drop-zone')).not.toBeNull();
      fireEvent.dragEnd(tab);
      expect(document.querySelector('.drop-zone')).toBeNull();

      fireEvent.dragStart(tab, { dataTransfer: dataTransfer() });
      fireEvent.mouseDown(document.body);
      expect(document.querySelector('.drop-zone')).toBeNull();
    });

    it('다른 칸 [+]를 누르면 포커스는 빠른 연결 입력창에 남는다(터미널로 입력이 새지 않음)', async () => {
      await twoTabs();
      drag(/a@h1/);
      dropOnPane(0, 190, 50);
      fireEvent.mouseDown(panel('s2'));
      fireEvent.click(
        within(bars()[1]!.closest('.pane-group') as HTMLElement).getByRole('button', {
          name: /새 연결/,
        }),
      );
      await flush();
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: '빠른 연결' }));
      expect(bars()[1]!.closest('.tabbar')!.getAttribute('data-focused')).toBe('true');
    });

    it('다른 칸으로 옮긴 터미널은 새 칸에 붙고 엔진을 다시 열지 않는다', async () => {
      const { engines } = await twoTabs();
      drag(/a@h1/);
      dropOnPane(0, 190, 50);
      await flush();
      expect(panel('s1').querySelector('.terminal-surface')).not.toBeNull();
      expect(bars()[1]!.closest('.pane-group')!.contains(panel('s1'))).toBe(true);
      expect(engines[0]!.opened).toBe(1);
    });

    it('비활성 칸 탭바에서 →는 그 칸의 탭을 돌린다', async () => {
      setup();
      for (const target of ['a@h1', 'b@h2', 'c@h3']) await quickConnect(target);
      drag(/a@h1/);
      dropOnPane(0, 190, 50);
      fireEvent.contextMenu(screen.getByRole('tab', { name: /a@h1/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: '칸 합치기' }));
      drag(/c@h3/);
      dropOnPane(0, 190, 50);
      // [b, a] | [c], 오른쪽 칸 활성. 왼쪽 칸 탭에서 →
      fireEvent.keyDown(screen.getByRole('tab', { name: /a@h1/ }), { key: 'ArrowRight' });
      expect(barTabs()).toEqual([['b@h2', 'a@h1'], ['c@h3']]);
      expect(screen.getByRole('tab', { name: /b@h2/ }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('tab', { name: /c@h3/ }).getAttribute('aria-selected')).toBe('true');
      expect(bars()[0]!.closest('.tabbar')!.getAttribute('data-focused')).toBe('true');
    });

    it('새 탭 버튼은 그 칸을 활성으로 하고 새 연결은 그 칸에 열린다', async () => {
      await twoTabs();
      drag(/a@h1/);
      dropOnPane(0, 190, 50);
      fireEvent.click(
        within(bars()[0]!.closest('.pane-group') as HTMLElement).getByRole('button', {
          name: /새 연결/,
        }),
      );
      await quickConnect('c@h3');
      expect(barTabs()).toEqual([['b@h2', 'c@h3'], ['a@h1']]);
    });

    it('F3.1 탭을 같은 탭바의 다른 탭 위에 놓으면 순서가 바뀐다', async () => {
      await twoTabs();
      drag(/b@h2/);
      const first = screen.getByRole('tab', { name: /a@h1/ });
      fireEvent.dragOver(first, { dataTransfer: dataTransfer() });
      fireEvent.drop(first, { dataTransfer: dataTransfer() });
      expect(barTabs()).toEqual([['b@h2', 'a@h1']]);
    });
  });
});

describe('서버 상태 줄 (F3.18)', () => {
  const stats = {
    os: 'Ubuntu 22.04.4 LTS',
    user: 'deploy',
    cpuPercent: 12,
    mem: { usedBytes: 1024 ** 3, totalBytes: 4 * 1024 ** 3 },
    net: { rxPerSec: 2048, txPerSec: 1024 },
    uptimeSec: 3 * 86400 + 4 * 3600,
    disk: { usedBytes: 12 * 1024 ** 3, totalBytes: 50 * 1024 ** 3 },
  };

  async function connected() {
    const env = setup();
    env.api.on('stats.read', () => ({ status: 'ok', stats }));
    await quickConnect('a@h1');
    act(() => env.api.emit({ type: 'session.state', sessionId: 's1', state: 'ready' }));
    await flush();
    return env;
  }

  afterEach(() => {
    vi.useRealTimers();
    for (const name of ['clientWidth', 'scrollWidth'] as const) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });

  it('AC34 칸 아래 상태 줄에 OS·CPU·RAM·네트워크·가동·아이디·디스크를 보여준다', async () => {
    await connected();
    const bar = screen.getByRole('group', { name: '서버 상태' });
    const text = bar.textContent ?? '';
    for (const part of [
      'Ubuntu 22.04.4 LTS',
      'CPU',
      '12%',
      'RAM',
      '1.0 GB / 4.0 GB',
      '↑ 1.0 KB/s',
      '↓ 2.0 KB/s',
      '3일 4시간',
      'deploy',
      '12 GB / 50 GB',
    ]) {
      expect(text).toContain(part);
    }
    // 칸 안, 터미널 아래
    const group = bar.closest('.pane-group')!;
    expect(group.contains(document.getElementById('panel-s1'))).toBe(true);
  });

  it('AC34 3초마다 다시 읽고, 연결이 준비되지 않으면 읽지 않고 상태를 보여준다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { api } = await connected();
    expect(api.requestsOf('stats.read')).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flush();
    expect(api.requestsOf('stats.read')).toHaveLength(2);

    act(() => api.emit({ type: 'session.state', sessionId: 's1', state: 'reconnecting' }));
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(api.requestsOf('stats.read')).toHaveLength(2);
    expect(screen.getByRole('group', { name: '서버 상태' }).textContent).toContain('재접속 중');
  });

  it('AC34 칸 폭을 넘으면 스크롤바 대신 ◀ ▶ 버튼으로 넘겨 본다', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('stats-viewport') ? 300 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('stats-track') ? 1000 : 0;
      },
    });
    await connected();
    const bar = screen.getByRole('group', { name: '서버 상태' });
    const prev = within(bar).getByRole('button', { name: '이전 항목' });
    const next = within(bar).getByRole('button', { name: '다음 항목' });
    const track = bar.querySelector<HTMLElement>('.stats-track')!;
    expect(prev).toHaveProperty('disabled', true);
    expect(next).toHaveProperty('disabled', false);
    fireEvent.click(next);
    expect(track.style.transform).toBe('translateX(-240px)');
    for (let i = 0; i < 5; i++) fireEvent.click(next);
    expect(track.style.transform).toBe('translateX(-700px)');
    expect(next).toHaveProperty('disabled', true);
    fireEvent.click(prev);
    expect(track.style.transform).toBe('translateX(-460px)');
  });

  it('칸 폭 안에 들어가면 좌우 버튼이 없다', async () => {
    await connected();
    expect(screen.queryByRole('button', { name: '다음 항목' })).toBeNull();
  });
});
