import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  applySettingsPatch,
  defaultAppSettings,
  emptyProfileStore,
  toProfilesView,
  type ProfileStore,
} from '@btterm/core';
import { App } from '../App';
import { FakeBtTermApi } from '../testing/FakeBtTermApi';
import { FakeTerminalEngine } from '../testing/FakeTerminalEngine';

const store: ProfileStore = {
  ...emptyProfileStore(),
  groups: [
    {
      id: 'prod',
      parentId: null,
      name: 'Prod',
      order: 0,
      defaults: { port: 2222, identityId: 'i1', icon: { kind: 'builtin', name: 'database' } },
    },
  ],
  identities: [{ id: 'i1', label: 'ubuntu-key', username: 'ubuntu', credentialId: null }],
  profiles: [
    {
      id: 'p1',
      groupId: 'prod',
      name: 'db-01',
      host: '10.0.0.5',
      overrides: { tabColor: 'red' },
      tags: [],
      updatedAt: 0,
    },
    {
      id: 'p2',
      groupId: null,
      name: 'laptop',
      host: '192.168.0.2',
      overrides: {},
      tags: [],
      updatedAt: 0,
    },
    {
      id: 'p3',
      groupId: null,
      name: 'pay-db',
      host: '10.9.9.9',
      overrides: {},
      tags: ['production'],
      updatedAt: 0,
    },
  ],
};

function setup(profiles: ProfileStore = store) {
  let settings = defaultAppSettings();
  const api = new FakeBtTermApi()
    .on('settings.get', () => settings)
    .on('settings.update', (r) => (settings = applySettingsPatch(settings, r.patch)))
    .on('profiles.get', () => toProfilesView(profiles))
    .on('profiles.saveIdentity', () => ({ ok: true, identityId: 'i-new' }))
    .on('session.openQuick', () => ({ sessionId: 'q1' }))
    .on('session.openProfile', (r) => ({ sessionId: `s-${r.profileId}` }))
    .on('stats.read', () => ({ status: 'unavailable' }))
    .on('keys.addFromPath', () => ({ ok: false, error: 'needs-passphrase' }));
  render(<App api={api} createEngine={(hooks) => new FakeTerminalEngine(hooks)} />);
  return { api };
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const tree = () => screen.getByRole('tree', { name: '서버 목록' });

describe('서버 관리 UI', () => {
  it('F5.1b 명령 팔레트에서 저장된 서버를 주소로 찾아 연다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.keyDown(window, { code: 'KeyP', ctrlKey: true, shiftKey: true });
    const input = screen.getByRole('combobox', { name: '명령 팔레트' });
    fireEvent.change(input, { target: { value: '10.9' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['pay-db10.9.9.9']);
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(api.requestsOf('session.openProfile')).toEqual([
      { type: 'session.openProfile', profileId: 'p3' },
    ]);
  });

  it('F3.14 production 서버에서 sudo 스니펫은 실행 전에 확인하고, 취소하면 보내지 않는다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.doubleClick(within(tree()).getByText('pay-db'));
    await flush();
    act(() => api.emit({ type: 'session.state', sessionId: 's-p3', state: 'ready' }));
    fireEvent.keyDown(window, { code: 'KeyL', ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole('tab', { name: '스니펫' }));
    fireEvent.click(screen.getByRole('button', { name: '새 스니펫' }));
    fireEvent.change(screen.getByRole('textbox', { name: '스니펫 이름' }), {
      target: { value: 'restart' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '스니펫 명령' }), {
      target: { value: 'sudo systemctl restart nginx' },
    });
    fireEvent.click(screen.getByRole('button', { name: '스니펫 저장' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'restart 실행' }));
    await flush();
    const confirm = screen.getByRole('alertdialog', { name: 'production 서버에서 sudo 실행' });
    fireEvent.click(within(confirm).getByRole('button', { name: '취소' }));
    await flush();
    expect(api.written.get('s-p3') ?? []).toEqual([]);
  });

  describe('빈 칸 서버 카드 (F1.2b, DF4)', () => {
    const cards = () =>
      within(screen.getByRole('region', { name: '서버 바로 열기' }))
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'));

    it('고정 서버 먼저, 그다음 최근 접속 순. 누르면 접속한다', async () => {
      const [db, laptop, pay] = store.profiles;
      const { api } = setup({
        ...store,
        profiles: [
          { ...db!, lastConnectedAt: 100 },
          { ...laptop!, pinned: true },
          { ...pay!, lastConnectedAt: 200 },
        ],
      });
      await flush();
      expect(cards()).toEqual([
        'laptop 192.168.0.2 접속',
        'pay-db 10.9.9.9 접속',
        'db-01 10.0.0.5 접속',
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'pay-db 10.9.9.9 접속' }));
      await flush();
      expect(api.requestsOf('session.openProfile')).toEqual([
        { type: 'session.openProfile', profileId: 'p3' },
      ]);
    });

    it('고정·최근 접속 서버가 없으면 카드를 그리지 않는다', async () => {
      setup();
      await flush();
      expect(screen.queryByRole('region', { name: '서버 바로 열기' })).toBeNull();
    });
  });

  it('F1.2 그룹 트리: ←로 접고 →로 펴며 Enter로 접속한다', async () => {
    const { api } = setup();
    await flush();
    const group = within(tree()).getByRole('treeitem', { name: 'Prod' });
    expect(group.getAttribute('aria-expanded')).toBe('true');
    group.focus();
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(within(tree()).queryByRole('treeitem', { name: /db-01/ })).toBeNull();
    fireEvent.keyDown(within(tree()).getByRole('treeitem', { name: 'Prod' }), {
      key: 'ArrowRight',
    });
    const db = within(tree()).getByRole('treeitem', { name: /db-01/ });
    fireEvent.keyDown(db, { key: 'Enter' });
    await flush();
    expect(api.requestsOf('session.openProfile')).toEqual([
      { type: 'session.openProfile', profileId: 'p1' },
    ]);
  });

  it('F1.2 그룹 행은 폴더 아이콘으로 구분하고, 펼침·접힘과 그룹 색을 보여 준다', async () => {
    setup();
    await flush();
    const folder = () =>
      within(tree()).getByRole('treeitem', { name: 'Prod' }).querySelector('.folder-icon');
    expect(folder()?.getAttribute('data-open')).toBe('true');
    expect(folder()?.querySelector('svg')).not.toBeNull();
    fireEvent.click(within(tree()).getByRole('treeitem', { name: 'Prod' }));
    expect(folder()?.getAttribute('data-open')).toBe('false');
  });

  it('AC29 그룹 아이콘을 물려받아 표시한다', async () => {
    setup();
    await flush();
    const db = within(tree()).getByRole('treeitem', { name: /db-01/ });
    expect(db.querySelector('.icon-tile')?.getAttribute('data-icon')).toBe('database');
    const laptop = within(tree()).getByRole('treeitem', { name: /laptop/ });
    expect(laptop.querySelector('.icon-tile')?.getAttribute('data-icon')).toBe('server');
  });

  it('컨텍스트 메뉴로 고정하고 삭제는 확인을 거친다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.contextMenu(within(tree()).getByRole('treeitem', { name: /laptop/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '고정' }));
    await flush();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toMatchObject({
      id: 'p2',
      pinned: true,
    });

    fireEvent.contextMenu(within(tree()).getByRole('treeitem', { name: /laptop/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    await flush();
    expect(api.requestsOf('profiles.deleteProfile')).toEqual([
      { type: 'profiles.deleteProfile', profileId: 'p2' },
    ]);
  });

  it('F3.1 저장된 서버의 탭은 탭 색 띠를 보여 준다', async () => {
    setup();
    await flush();
    fireEvent.doubleClick(within(tree()).getByText('db-01'));
    await flush();
    const tab = screen.getByRole('tab', { name: /db-01/ });
    expect(tab.closest('.tab-wrap')?.getAttribute('data-color')).toBe('red');
  });

  it('F6.11 서버 편집 고급 설정의 연결 직후 명령은 한 줄로 저장한다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.keyDown(within(tree()).getByRole('treeitem', { name: /laptop/ }), { key: 'F2' });
    const dialog = screen.getByRole('dialog', { name: '서버 편집' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /연결 직후 명령/ }), {
      target: { value: 'cd /srv/app\nsudo -i' },
    });
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile.overrides).toMatchObject({
      startupCommand: 'cd /srv/appsudo -i',
    });
  });

  it('F3.1 서버 편집에서 탭 색을 고르면 저장한다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.keyDown(within(tree()).getByRole('treeitem', { name: /laptop/ }), { key: 'F2' });
    const dialog = screen.getByRole('dialog', { name: '서버 편집' });
    const colors = within(dialog).getByRole('radiogroup', { name: '탭 색' });
    fireEvent.click(within(colors).getByRole('radio', { name: '초록' }));
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile.overrides).toMatchObject({
      tabColor: 'green',
    });
  });

  it('F1.1 서버 편집: 그룹에서 물려받는 값을 보여 주고, 다른 재정의는 유지한다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.keyDown(within(tree()).getByRole('treeitem', { name: /db-01/ }), { key: 'F2' });
    const dialog = screen.getByRole('dialog', { name: '서버 편집' });
    expect(within(dialog).getAllByText('상속: Prod (2222)')).toHaveLength(1);
    expect(dialog.textContent).toContain('상속: Prod (ubuntu-key)');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /포트/ }), {
      target: { value: '22' },
    });
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile.overrides).toEqual({
      tabColor: 'red',
      port: 22,
    });
    expect(screen.queryByRole('dialog', { name: '서버 편집' })).toBeNull();
  });

  it('UX5 편집 창을 Esc로 닫거나 메뉴를 닫으면 포커스가 트리 행으로 돌아온다', async () => {
    setup();
    await flush();
    const laptop = within(tree()).getByRole('treeitem', { name: /laptop/ });
    laptop.focus();
    fireEvent.keyDown(laptop, { key: 'F2' });
    expect(screen.getByRole('dialog', { name: '서버 편집' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(within(tree()).getByRole('treeitem', { name: /laptop/ }));

    fireEvent.keyDown(document.activeElement!, { key: 'ContextMenu' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(within(tree()).getByRole('treeitem', { name: /laptop/ }));
  });

  it('메뉴에서 연 편집 창을 닫으면 메뉴를 연 트리 행으로 포커스가 돌아온다(리뷰 M2)', async () => {
    setup();
    await flush();
    const laptop = within(tree()).getByRole('treeitem', { name: /laptop/ });
    laptop.focus();
    fireEvent.keyDown(laptop, { key: 'ContextMenu' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitem', { name: '편집' }));
    expect(screen.getByRole('dialog', { name: '서버 편집' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await flush();
    expect(document.activeElement).toBe(within(tree()).getByRole('treeitem', { name: /laptop/ }));
  });

  it('UX 검토 U3 새 서버 창은 호스트부터 묻고, 비밀번호 칸이 바로 보이며, 이름은 비우면 호스트로 저장한다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '새 서버' }));
    const dialog = screen.getByRole('dialog', { name: '새 서버' });
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: '호스트' }));
    expect(dialog.querySelector('input[name=password]')).not.toBeNull();
    const advanced = dialog.querySelector('details');
    expect(advanced?.open).toBe(false);
    expect(advanced?.querySelector('input[name=port]')).not.toBeNull();

    fireEvent.change(within(dialog).getByRole('textbox', { name: '호스트' }), {
      target: { value: '10.0.0.7' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '사용자명' }), {
      target: { value: 'ops' },
    });
    fireEvent.change(dialog.querySelector('input[name=password]')!, { target: { value: 'pw' } });
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveIdentity')[0]).toMatchObject({
      identity: { username: 'ops' },
      auth: { kind: 'password', password: 'pw' },
    });
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toMatchObject({
      name: '10.0.0.7',
      host: '10.0.0.7',
    });
  });

  it('새 접속 계정은 사용자명이 있어야 저장하고, 그룹을 바꾸면 계정 기본값도 따라간다(리뷰 2·3)', async () => {
    const { api } = setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '새 서버' }));
    const dialog = screen.getByRole('dialog', { name: '새 서버' });
    const identity = () =>
      (within(dialog).getByRole('combobox', { name: /접속 계정/ }) as HTMLSelectElement).value;
    expect(identity()).toBe('__new__');
    fireEvent.change(within(dialog).getByRole('textbox', { name: '호스트' }), {
      target: { value: '10.0.0.7' },
    });
    fireEvent.submit(dialog);
    await flush();
    expect(within(dialog).getByRole('alert').textContent).toContain('사용자명');
    expect(api.requestsOf('profiles.saveProfile')).toEqual([]);

    // Prod 그룹에는 접속 계정(ubuntu-key)이 있으므로 물려받기로 바뀐다
    fireEvent.change(within(dialog).getByRole('combobox', { name: '그룹' }), {
      target: { value: 'prod' },
    });
    expect(identity()).toBe('');
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveIdentity')).toEqual([]);
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toMatchObject({ groupId: 'prod' });
  });

  it('F1.1b 새 서버를 새 Identity(비밀번호)와 함께 만든다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '새 서버' }));
    const dialog = screen.getByRole('dialog', { name: '새 서버' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '이름' }), {
      target: { value: 'web-09' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '호스트' }), {
      target: { value: '10.0.0.9' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /접속 계정/ }), {
      target: { value: '__new__' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '사용자명' }), {
      target: { value: 'deploy' },
    });
    fireEvent.change(dialog.querySelector('input[name=password]')!, {
      target: { value: 's3cret' },
    });
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveIdentity')[0]).toMatchObject({
      identity: { username: 'deploy' },
      auth: { kind: 'password', password: 's3cret' },
    });
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toMatchObject({
      name: 'web-09',
      host: '10.0.0.9',
      overrides: { identityId: 'i-new' },
    });
  });

  it('F7.3 키 추가 실패 이유를 보여 주고 입력한 암호는 지운다', async () => {
    setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '키 관리' }));
    fireEvent.click(screen.getByRole('button', { name: '키 추가' }));
    const dialog = screen.getByRole('dialog', { name: '개인키 추가' });
    fireEvent.change(dialog.querySelector('input[name=key-passphrase]')!, {
      target: { value: 'oops' },
    });
    fireEvent.submit(dialog);
    await flush();
    expect(within(dialog).getByRole('alert').textContent).toContain('키 암호를 입력하세요');
    expect((dialog.querySelector('input[name=key-passphrase]') as HTMLInputElement).value).toBe('');
  });

  it('F7.7 새 키 만들기: 형식·암호·기억 방식을 main에 보내고 암호 입력은 지운다', async () => {
    const { api } = setup();
    api.on('keys.generate', () => ({ keyId: 'k-new' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '키 관리' }));
    fireEvent.click(screen.getByRole('button', { name: '키 추가' }));
    const dialog = screen.getByRole('dialog', { name: '개인키 추가' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /새 키 만들기/ }));
    expect(dialog.querySelector('input[name=key-path]')).toBeNull();
    expect(within(dialog).getByRole('radio', { name: /Ed25519/ })).toHaveProperty('checked', true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /RSA 4096/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: '이름' }), {
      target: { value: 'deploy' },
    });
    fireEvent.change(dialog.querySelector('input[name=key-passphrase]')!, {
      target: { value: 'pp' },
    });
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('keys.generate')).toEqual([
      {
        type: 'keys.generate',
        label: 'deploy',
        keyType: 'rsa',
        passphrase: 'pp',
        passphrasePolicy: 'session',
      },
    ]);
    expect(screen.queryByRole('dialog', { name: '개인키 추가' })).toBeNull();
  });

  it('F7.7 보관소 키만 개인키 내보내기 버튼이 있다', async () => {
    const { api } = setup({
      ...store,
      keys: [
        {
          id: 'kv',
          label: 'made-here',
          source: { kind: 'vault', secretRef: 'ref' },
          keyType: 'ed25519',
          publicKey: 'ssh-ed25519 AAAA',
          fingerprintSha256: 'SHA256:x',
          encrypted: false,
          createdAt: 0,
        },
        {
          id: 'kp',
          label: 'on-disk',
          source: { kind: 'path', path: '~/.ssh/id' },
          keyType: 'ed25519',
          publicKey: 'ssh-ed25519 BBBB',
          fingerprintSha256: 'SHA256:y',
          encrypted: false,
          createdAt: 0,
        },
      ],
    });
    api.on('keys.export', () => ({ exported: true }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '키 관리' }));
    const exports = screen.getAllByRole('button', { name: '개인키 내보내기' });
    expect(exports).toHaveLength(1);
    fireEvent.click(exports[0]!);
    await flush();
    expect(api.requestsOf('keys.export')).toEqual([{ type: 'keys.export', keyId: 'kv' }]);
  });

  it('F7.8 연결된 탭을 골라 공개키를 서버에 등록하고 결과를 알린다', async () => {
    const { api } = setup({
      ...store,
      keys: [
        {
          id: 'kv',
          label: 'made-here',
          source: { kind: 'vault', secretRef: 'ref' },
          keyType: 'ed25519',
          publicKey: 'ssh-ed25519 AAAA',
          fingerprintSha256: 'SHA256:x',
          encrypted: false,
          createdAt: 0,
        },
      ],
    });
    api.on('keys.install', () => ({ ok: true, result: { added: true } }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '키 관리' }));
    expect(screen.getByRole('button', { name: '서버에 등록' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));

    fireEvent.doubleClick(within(tree()).getByText('db-01'));
    await flush();
    act(() => api.emit({ type: 'session.state', sessionId: 's-p1', state: 'ready' }));
    fireEvent.click(screen.getByRole('button', { name: '키 관리' }));
    const dialog = screen.getByRole('dialog', { name: '키 관리' });
    expect(within(dialog).getByRole('combobox', { name: '등록할 서버' })).toHaveProperty(
      'value',
      's-p1',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '서버에 등록' }));
    await flush();
    expect(api.requestsOf('keys.install')).toEqual([
      { type: 'keys.install', keyId: 'kv', sessionId: 's-p1' },
    ]);
    expect(within(dialog).getByRole('status').textContent).toContain('db-01');
  });

  it('F2.4b 알려진 호스트: 지문을 보고 btterm 항목만 지운다. ~/.ssh 항목은 읽기 전용', async () => {
    const { api } = setup();
    let entries = [
      {
        source: 'app',
        line: 1,
        hosts: '[db-01]:2222',
        keyType: 'ssh-ed25519',
        key: 'AAAA1',
        fingerprint: 'SHA256:aaa',
        marker: null,
      },
      {
        source: 'user',
        line: 3,
        hosts: null,
        keyType: 'ssh-rsa',
        key: 'BBBB2',
        fingerprint: 'SHA256:bbb',
        marker: null,
      },
    ];
    api
      .on('knownHosts.list', () => ({ entries }))
      .on('knownHosts.remove', () => {
        entries = entries.slice(1);
        return { ok: true };
      });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '키 관리' }));
    fireEvent.click(screen.getByRole('button', { name: '알려진 호스트' }));
    await flush();
    const dialog = screen.getByRole('dialog', { name: '알려진 호스트' });
    expect(dialog.textContent).toContain('SHA256:aaa');
    expect(dialog.textContent).toContain('해시된 이름');
    const removes = within(dialog).getAllByRole('button', { name: /지우기/ });
    expect(removes).toHaveLength(1);
    // 확인은 main의 시스템 확인창이 한다(보안 리뷰 M-1)
    fireEvent.click(removes[0]!);
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.requestsOf('knownHosts.remove')).toEqual([
      { type: 'knownHosts.remove', line: 1, keyType: 'ssh-ed25519', key: 'AAAA1' },
    ]);
    expect(dialog.textContent).not.toContain('SHA256:aaa');
  });

  it('F1.3 빠른 연결 뒤 저장 토스트로 서버를 저장한다', async () => {
    const { api } = setup();
    fireEvent.change(screen.getByRole('combobox', { name: '빠른 연결' }), {
      target: { value: 'root@10.1.1.1:2200' },
    });
    fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
    await flush();
    act(() => api.emit({ type: 'session.state', sessionId: 'q1', state: 'ready' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await flush();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toMatchObject({
      host: '10.1.1.1',
      overrides: { port: 2200, username: 'root' },
    });
  });

  it('F1.11 서버 편집에서 아이콘은 그림 타일로, 색은 팔레트 원으로 고른다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.keyDown(within(tree()).getByRole('treeitem', { name: /laptop/ }), { key: 'F2' });
    const dialog = screen.getByRole('dialog', { name: '서버 편집' });
    const icons = within(dialog).getByRole('radiogroup', { name: '아이콘' });
    expect(within(icons).getAllByRole('radio')).toHaveLength(22);
    expect(icons.querySelector('svg')).not.toBeNull();
    expect(within(icons).queryByText('database')).toBeNull();

    const colors = within(dialog).getByRole('radiogroup', { name: '아이콘 색' });
    // 그룹 값을 쓰는 동안 색은 고를 수 없다
    expect(within(colors).getByRole('radio', { name: '초록' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(icons).getByRole('radio', { name: '터미널' }));
    expect(within(icons).getByRole('radio', { name: '터미널' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(colors).getByRole('radio', { name: '초록' }));
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile.overrides.icon).toEqual({
      kind: 'builtin',
      name: 'terminal',
      color: 'green',
    });
  });

  it('F1.11 그룹 편집도 같은 아이콘 선택을 쓴다', async () => {
    setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '새 그룹' }));
    const dialog = screen.getByRole('dialog', { name: '새 그룹' });
    expect(within(dialog).getByRole('radiogroup', { name: '아이콘' })).toBeTruthy();
    expect(within(dialog).getByRole('radiogroup', { name: '아이콘 색' })).toBeTruthy();
  });

  it('F3.18 서버 편집에서 서버 상태 줄을 끄면 저장한다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.keyDown(within(tree()).getByRole('treeitem', { name: /db-01/ }), { key: 'F2' });
    const dialog = screen.getByRole('dialog', { name: '서버 편집' });
    const select = within(dialog).getByRole('combobox', { name: '서버 상태 줄' });
    expect((select as HTMLSelectElement).value).toBe('');
    fireEvent.change(select, { target: { value: 'off' } });
    fireEvent.submit(dialog);
    await flush();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile.overrides).toEqual({
      tabColor: 'red',
      serverStats: false,
    });
  });

  describe('서버 트리 끌어 놓기 (F1.2a)', () => {
    const dataTransfer = () => ({
      setData: () => undefined,
      getData: () => '',
      effectAllowed: 'move',
      dropEffect: 'move',
    });
    const row = (name: RegExp | string) =>
      within(tree()).getAllByRole('treeitem', { name }).at(-1)!;

    /** from을 끌어 to의 세로 위치 y(행 높이 40 기준)에 놓는다. */
    function dragTo(from: HTMLElement, to: HTMLElement, y: number) {
      fireEvent.dragStart(from, { dataTransfer: dataTransfer() });
      to.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 200, height: 40, right: 200, bottom: 40 }) as DOMRect;
      // jsdom에는 DragEvent가 없어 좌표를 직접 붙인다.
      const at = (event: Event) => Object.defineProperties(event, { clientY: { value: y } });
      fireEvent(to, at(createEvent.dragOver(to, { dataTransfer: dataTransfer() })));
      const zone = to.getAttribute('data-drop');
      fireEvent(to, at(createEvent.drop(to, { dataTransfer: dataTransfer() })));
      fireEvent.dragEnd(from, { dataTransfer: dataTransfer() });
      return zone;
    }

    /** 상속 값이 바뀌는 이동의 확인창(보안 리뷰 L1)에서 고른다 */
    async function answerMove(ok: boolean) {
      await flush();
      const dialog = screen.getByRole('alertdialog', { name: '그룹 설정이 바뀝니다' });
      fireEvent.click(within(dialog).getByRole('button', { name: ok ? '옮기기' : '취소' }));
      await flush();
    }

    it('AC35 서버를 그룹 행 가운데에 놓으면 그 그룹의 마지막 자식으로 옮긴다', async () => {
      const { api } = setup();
      await flush();
      expect(dragTo(row(/laptop/), row('Prod'), 20)).toBe('inside');
      await answerMove(true);
      expect(api.requestsOf('profiles.move')).toEqual([
        {
          type: 'profiles.move',
          item: { kind: 'profile', id: 'p2' },
          parentId: 'prod',
          index: 1,
        },
      ]);
    });

    it('AC35 그룹 안 서버를 최상위 서버 행 위쪽에 놓으면 그룹에서 빠져 그 앞에 놓인다', async () => {
      const { api } = setup();
      await flush();
      expect(dragTo(row(/db-01/), row(/laptop/), 5)).toBe('before');
      await answerMove(true);
      expect(api.requestsOf('profiles.move')[0]).toMatchObject({
        item: { kind: 'profile', id: 'p1' },
        parentId: null,
        index: 1,
      });
    });

    it('AC35 그룹을 같은 단계 서버 행 아래쪽에 놓으면 그 뒤로 순서를 바꾼다', async () => {
      const { api } = setup();
      await flush();
      expect(dragTo(row('Prod'), row(/pay-db/), 35)).toBe('after');
      await flush();
      // 부모가 그대로라 상속 값이 바뀌지 않으므로 확인 없이 옮긴다
      expect(screen.queryByRole('alertdialog')).toBeNull();
      // 최상위: Prod, laptop, pay-db → Prod를 뺀 목록에서 pay-db 뒤 = 2
      expect(api.requestsOf('profiles.move')[0]).toMatchObject({
        item: { kind: 'group', id: 'prod' },
        parentId: null,
        index: 2,
      });
    });

    it('AC35 목록 빈 곳에 놓으면 최상위 맨 끝으로 뺀다', async () => {
      const { api } = setup();
      await flush();
      const from = row(/db-01/);
      fireEvent.dragStart(from, { dataTransfer: dataTransfer() });
      fireEvent.dragOver(tree(), { dataTransfer: dataTransfer() });
      fireEvent.drop(tree(), { dataTransfer: dataTransfer() });
      await answerMove(true);
      expect(api.requestsOf('profiles.move')[0]).toMatchObject({
        item: { kind: 'profile', id: 'p1' },
        parentId: null,
        index: 3,
      });
    });

    it('AC35 옮기면 접속 계정·인증·시작 명령이 바뀌는 경우 확인하고, 취소하면 옮기지 않는다', async () => {
      const { api } = setup();
      await flush();
      dragTo(row(/laptop/), row('Prod'), 20);
      await flush();
      const dialog = screen.getByRole('alertdialog', { name: '그룹 설정이 바뀝니다' });
      expect(dialog.textContent).toContain('laptop');
      expect(document.activeElement?.textContent).toBe('취소');
      await answerMove(false);
      expect(api.requestsOf('profiles.move')).toEqual([]);
    });

    it('그룹을 자기 자신 위에 놓거나 검색 중이면 옮기지 않는다', async () => {
      const { api } = setup();
      await flush();
      expect(dragTo(row('Prod'), row('Prod'), 20)).toBeNull();
      await flush();
      expect(api.requestsOf('profiles.move')).toEqual([]);

      fireEvent.change(screen.getByRole('searchbox', { name: '서버 검색' }), {
        target: { value: 'lap' },
      });
      expect(row(/laptop/).getAttribute('draggable')).toBe('false');
    });
  });

  it('AC34 production 태그 서버는 상태 줄을 그리지 않고 원격 조회도 하지 않는다', async () => {
    const { api } = setup();
    await flush();
    fireEvent.doubleClick(within(tree()).getByText('pay-db'));
    await flush();
    act(() => api.emit({ type: 'session.state', sessionId: 's-p3', state: 'ready' }));
    await flush();
    expect(screen.queryByRole('group', { name: '서버 상태' })).toBeNull();
    expect(api.requestsOf('stats.read')).toEqual([]);

    fireEvent.doubleClick(within(tree()).getByText('laptop'));
    await flush();
    act(() => api.emit({ type: 'session.state', sessionId: 's-p2', state: 'ready' }));
    await flush();
    expect(screen.getByRole('group', { name: '서버 상태' })).toBeTruthy();
    expect(api.requestsOf('stats.read')).toEqual([{ type: 'stats.read', sessionId: 's-p2' }]);
  });
});
