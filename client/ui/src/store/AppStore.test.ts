import { describe, expect, it } from 'vitest';
import { defaultAppSettings, emptyProfileStore, toProfilesView } from '@btterm/core';
import { hasMessage } from '../i18n';
import { FakeBtTermApi } from '../testing/FakeBtTermApi';
import { allGroups } from '../workspace/groupLayout';
import { AppStore } from './AppStore';

const view = toProfilesView({
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
  ],
});

function setup() {
  const api = new FakeBtTermApi()
    .on('profiles.get', () => view)
    .on('session.openProfile', () => ({ sessionId: 's1' }))
    .on('session.openQuick', () => ({ sessionId: 'q1' }));
  const store = new AppStore(api);
  return { api, store };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AppStore', () => {
  it('시작하면 프로필을 읽고 이벤트를 구독하며, dispose하면 구독을 푼다', async () => {
    const { api, store } = setup();
    store.start();
    await flush();
    expect(store.getState().profiles?.profiles[0]?.name).toBe('web-01');
    expect(api.listenerCount).toBe(1);
    store.dispose();
    expect(api.listenerCount).toBe(0);
  });

  it('프로필로 열면 서버 이름 탭을 만들고 활성화한다', async () => {
    const { store } = setup();
    store.start();
    await flush();
    await store.openProfile('p1');
    expect(store.getState().tabs).toEqual([
      { sessionId: 's1', title: 'web-01', profileId: 'p1', state: 'connecting' },
    ]);
    expect(store.getState().activeId).toBe('s1');
  });

  it('열기 실패는 알림으로, 취소는 조용히 처리한다', async () => {
    const { api, store } = setup();
    api.on('session.openProfile', () => ({ ok: false, error: 'key-missing' }));
    await store.openProfile('p1');
    expect(store.getState().notice).toEqual({ key: 'error.key-missing', tone: 'error' });

    api.on('session.openProfile', () => ({ ok: false, error: 'cancelled' }));
    store.dismissNotice();
    await store.openProfile('p1');
    expect(store.getState().notice).toBeNull();
    expect(store.getState().tabs).toEqual([]);
  });

  it('프로필 열기가 이유 없이 실패해도 알린다(리뷰)', async () => {
    const { api, store } = setup();
    api.on('session.openProfile', () => ({}));
    await store.openProfile('p1');
    expect(store.getState().notice).toEqual({ key: 'error.open-failed', tone: 'error' });
  });

  it('UX6 사전 조회는 프로토타입 이름을 키로 보지 않는다', () => {
    expect(hasMessage('toString')).toBe(false);
    expect(hasMessage('error.dns')).toBe(true);
  });

  it('UX6 빠른 연결 실패도 알리고, 사전에 없는 오류 코드는 일반 문구로 바꾼다', async () => {
    const { api, store } = setup();
    api.on('session.openQuick', () => ({ sessionId: null, error: 'dns' }));
    await store.openQuick('nohost', 22, 'root');
    expect(store.getState().notice).toEqual({ key: 'error.dns', tone: 'error' });

    api.on('session.openQuick', () => ({ sessionId: null, error: 'weird-code' }));
    await store.openQuick('h', 22, 'root');
    expect(store.getState().notice).toEqual({ key: 'error.open-failed', tone: 'error' });
  });

  it('UX6 트리에서 한 삭제·고정·이동이 실패하면 알린다', async () => {
    const { api, store } = setup();
    store.start();
    await flush();
    api.on('profiles.deleteProfile', () => ({ ok: false, error: 'io' }));
    await store.deleteProfile('p1');
    expect(store.getState().notice).toEqual({ key: 'notice.saveFailed', tone: 'error' });
  });

  it('세션 상태 이벤트를 탭에 반영한다(재접속 정보 포함)', async () => {
    const { api, store } = setup();
    store.start();
    await store.openQuick('h', 22, 'u');
    api.emit({
      type: 'session.state',
      sessionId: 'q1',
      state: 'reconnecting',
      reconnect: { attempt: 2, nextDelayMs: 2000 },
    });
    expect(store.getState().tabs[0]).toMatchObject({
      title: 'u@h',
      state: 'reconnecting',
      reconnect: { attempt: 2, nextDelayMs: 2000 },
    });
    api.emit({ type: 'session.state', sessionId: 'q1', state: 'failed', errorCode: 'refused' });
    expect(store.getState().tabs[0]).toMatchObject({ state: 'failed', errorCode: 'refused' });
    expect(store.getState().tabs[0]?.reconnect).toBeUndefined();
  });

  it('프롬프트는 차례대로 하나씩 보여준다', () => {
    const { api, store } = setup();
    store.start();
    api.emit({
      type: 'prompt.request',
      promptId: 'a',
      prompt: { kind: 'passphrase', keyLabel: 'k' },
    });
    api.emit({
      type: 'prompt.request',
      promptId: 'b',
      prompt: { kind: 'passphrase', keyLabel: 'k2' },
    });
    expect(store.getState().prompts.map((p) => p.promptId)).toEqual(['a', 'b']);
    store.respondPrompt('a', { kind: 'cancel' });
    expect(store.getState().prompts.map((p) => p.promptId)).toEqual(['b']);
    expect(api.requestsOf('prompt.respond')[0]).toMatchObject({ promptId: 'a' });
  });

  it('탭 닫기·순환: 닫으면 이웃 탭이 활성화되고 세션 종료를 요청한다', async () => {
    const { api, store } = setup();
    let n = 0;
    api.on('session.openQuick', () => ({ sessionId: `t${++n}` }));
    for (let i = 0; i < 3; i++) await store.openQuick('h', 22, 'u');
    expect(store.getState().activeId).toBe('t3');
    store.cycleTab(1);
    expect(store.getState().activeId).toBe('t1');
    store.cycleTab(-1);
    expect(store.getState().activeId).toBe('t3');
    store.closeTab('t3');
    expect(store.getState().activeId).toBe('t2');
    expect(api.requestsOf('session.close')).toEqual([{ type: 'session.close', sessionId: 't3' }]);
  });

  it('profiles.changed 이벤트로 목록을 갱신한다', () => {
    const { api, store } = setup();
    store.start();
    api.emit({ type: 'profiles.changed', view: toProfilesView(emptyProfileStore()) });
    expect(store.getState().profiles?.profiles).toEqual([]);
  });

  it('구독자는 상태가 바뀔 때 알림을 받는다', async () => {
    const { store } = setup();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.toggleSidebar();
    expect(store.getState().ui.sidebarOpen).toBe(false);
    expect(calls).toBe(1);
    unsubscribe();
    store.toggleSidebar();
    expect(calls).toBe(1);
  });
});

describe('AppStore 설정·확인·기록', () => {
  function withSettings() {
    const env = setup();
    let saved = defaultAppSettings();
    env.api
      .on('settings.get', () => saved)
      .on('settings.update', (r) => {
        saved = {
          ...saved,
          terminal: { ...saved.terminal, ...r.patch.terminal },
          ui: { ...saved.ui, ...r.patch.ui },
        } as typeof saved;
        return saved;
      });
    return env;
  }

  it('시작하면 설정을 읽고 패널 상태를 복원한다(F3.15 열린 상태 기억)', async () => {
    const env = withSettings();
    env.api.on('settings.get', () => ({
      ...defaultAppSettings(),
      ui: { sidebarOpen: false, toolPanel: 'history', lastToolPanel: 'history' },
    }));
    env.store.start();
    await flush();
    expect(env.store.getState().settings?.terminal.themeId).toBe('btterm-dark');
    expect(env.store.getState().ui).toMatchObject({ sidebarOpen: false, toolPanel: 'history' });
  });

  it('터미널 기본값을 바꾸면 저장하고, 패널 토글도 저장한다', async () => {
    const env = withSettings();
    env.store.start();
    await flush();
    await env.store.updateTerminalDefaults({ fontSize: 16 });
    expect(env.store.getState().settings?.terminal.fontSize).toBe(16);
    env.store.toggleToolPanel('history');
    await flush();
    expect(env.api.requestsOf('settings.update').at(-1)?.patch.ui).toMatchObject({
      toolPanel: 'history',
      lastToolPanel: 'history',
    });
  });

  it('확인창은 응답으로 끝나는 약속을 돌려준다', async () => {
    const { store } = setup();
    const answer = store.requestConfirm({ kind: 'paste', lineCount: 3 });
    expect(store.getState().confirm).toMatchObject({ kind: 'paste', lineCount: 3 });
    store.resolveConfirm(true);
    expect(await answer).toBe(true);
    expect(store.getState().confirm).toBeNull();
  });

  it('SEC-6 링크는 확인한 뒤에만 연다', async () => {
    const { api, store } = setup();
    const opened = store.openLink('https://example.com');
    store.resolveConfirm(false);
    await opened;
    expect(api.requestsOf('link.open')).toEqual([]);
    const again = store.openLink('https://example.com');
    store.resolveConfirm(true);
    await again;
    expect(api.requestsOf('link.open')).toEqual([
      { type: 'link.open', url: 'https://example.com' },
    ]);
  });

  it('F3.17a 활성 세션의 원격 기록을 읽어 둔다', async () => {
    const { api, store } = setup();
    api.on('history.load', () => ({ status: 'ok', entries: [{ command: 'ls', timestamp: null }] }));
    await store.openQuick('h', 22, 'u');
    await store.loadHistory();
    expect(store.getState().history).toEqual({
      sessionId: 'q1',
      status: 'ok',
      entries: [{ command: 'ls', timestamp: null }],
    });
  });

  it('찾기 막대를 열고 닫는다', () => {
    const { store } = setup();
    store.setFindOpen(true);
    expect(store.getState().ui.findOpen).toBe(true);
    store.setFindOpen(false);
    expect(store.getState().ui.findOpen).toBe(false);
  });
});

describe('AppStore 서버·키 관리', () => {
  function managed() {
    const api = new FakeBtTermApi()
      .on('profiles.get', () => view)
      .on('profiles.saveIdentity', () => ({ ok: true, identityId: 'i-new' }))
      .on('session.openQuick', () => ({ sessionId: 'q1' }))
      .on('keys.addFromPath', () => ({ ok: false, error: 'needs-passphrase' }));
    let n = 0;
    const store = new AppStore(api, { ids: () => `id-${++n}`, now: () => 1000 });
    store.start();
    return { api, store };
  }

  it('F1.1 새 서버를 새 Identity와 함께 저장한다(비밀번호는 main으로만)', async () => {
    const { api, store } = managed();
    await flush();
    await store.saveHost({
      profileId: null,
      name: 'web-02',
      host: '10.0.0.6',
      groupId: null,
      overrides: { port: 2222 },
      tags: ['nginx'],
      identity: {
        mode: 'new',
        label: 'ubuntu',
        username: 'ubuntu',
        auth: { kind: 'password', password: 'pw' },
      },
    });
    expect(api.requestsOf('profiles.saveIdentity')[0]).toMatchObject({
      identity: { label: 'ubuntu', username: 'ubuntu' },
      auth: { kind: 'password', password: 'pw' },
    });
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toEqual({
      id: 'id-1',
      groupId: null,
      name: 'web-02',
      host: '10.0.0.6',
      overrides: { port: 2222, identityId: 'i-new' },
      tags: ['nginx'],
      updatedAt: 1000,
    });
  });

  it('기존 서버를 고치면 고정·최근 정보를 유지한다', async () => {
    const { api, store } = managed();
    await flush();
    await store.togglePin('p1');
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toMatchObject({
      id: 'p1',
      pinned: true,
    });
  });

  it('AC35 새 그룹은 같은 단계의 맨 끝 순서로, 이동은 profiles.move 하나로 보낸다', async () => {
    const ordered = toProfilesView({
      ...emptyProfileStore(),
      groups: [{ id: 'g1', parentId: null, name: 'G1', order: 7, defaults: {} }],
      profiles: [{ ...view.profiles[0]!, order: 9 }],
    });
    const api = new FakeBtTermApi().on('profiles.get', () => ordered);
    const store = new AppStore(api, { ids: () => 'g-new', now: () => 1000 });
    store.start();
    await flush();
    await store.saveGroup({ id: null, parentId: null, name: 'Test', defaults: {} });
    expect(api.requestsOf('profiles.saveGroup')[0]?.group.order).toBe(10);

    await store.moveTreeItem({ kind: 'profile', id: 'p1' }, 'g1', 0);
    expect(api.requestsOf('profiles.move')).toEqual([
      { type: 'profiles.move', item: { kind: 'profile', id: 'p1' }, parentId: 'g1', index: 0 },
    ]);
  });

  it('키 추가 실패 이유를 돌려준다', async () => {
    const { store } = managed();
    const result = await store.addKey({
      type: 'keys.addFromPath',
      label: 'k',
      path: '~/.ssh/id',
      passphrasePolicy: 'ask',
    });
    expect(result).toEqual({ ok: false, error: 'needs-passphrase' });
  });

  it('F1.3 빠른 연결이 준비되면 저장 토스트를 띄우고, 저장하면 서버로 남긴다', async () => {
    const { api, store } = managed();
    await store.openQuick('10.0.0.7', 2200, 'root');
    api.emit({ type: 'session.state', sessionId: 'q1', state: 'ready' });
    expect(store.getState().toast).toEqual({
      kind: 'saveQuick',
      sessionId: 'q1',
      host: '10.0.0.7',
      port: 2200,
      username: 'root',
    });
    await store.saveQuickTarget();
    expect(api.requestsOf('profiles.saveProfile')[0]?.profile).toMatchObject({
      name: '10.0.0.7',
      host: '10.0.0.7',
      overrides: { port: 2200, username: 'root' },
    });
    expect(store.getState().toast).toBeNull();
    // 같은 탭이 다시 ready가 돼도(재접속) 다시 묻지 않는다
    api.emit({ type: 'session.state', sessionId: 'q1', state: 'ready' });
    expect(store.getState().toast).toBeNull();
  });

  it('대화상자를 열고 닫는다', () => {
    const { store } = managed();
    store.openDialog({ kind: 'keys' });
    expect(store.getState().dialog).toEqual({ kind: 'keys' });
    store.closeDialog();
    expect(store.getState().dialog).toBeNull();
  });
});

describe('AppStore SFTP·전송(F4)', () => {
  function files() {
    const api = new FakeBtTermApi()
      .on('session.openQuick', () => ({ sessionId: 'q1' }))
      .on('files.op', (r) =>
        r.op.kind === 'list'
          ? { ok: true, result: { path: '/var/log', entries: [] } }
          : { ok: false, error: 'denied' },
      )
      .on('files.download', () => ({ ok: true, transferIds: ['t1'] }));
    const store = new AppStore(api);
    store.start();
    return { api, store };
  }

  it('파일 작업 결과와 실패 이유를 돌려준다', async () => {
    const { store } = files();
    expect(await store.filesOp('q1', { kind: 'list', path: '/var/log' })).toEqual({
      ok: true,
      result: { path: '/var/log', entries: [] },
    });
    expect(await store.filesOp('q1', { kind: 'mkdir', path: '/root/x' })).toEqual({
      ok: false,
      error: 'denied',
    });
  });

  it('F4.5 탭의 현재 폴더를 기억한다', async () => {
    const { store } = files();
    await store.openQuick('h', 22, 'u');
    store.setCwd('q1', '/var/log');
    expect(store.getState().tabs[0]?.cwd).toBe('/var/log');
  });

  it('F4.4 전송 상태 이벤트를 모아 두고 끝난 항목은 지울 수 있다', () => {
    const { api, store } = files();
    const status = {
      id: 't1',
      sessionId: 'q1',
      direction: 'download' as const,
      name: 'syslog',
      state: 'running' as const,
      bytes: 5,
      total: 10,
    };
    api.emit({ type: 'transfer.status', status });
    api.emit({ type: 'transfer.status', status: { ...status, state: 'done', bytes: 10 } });
    expect(store.getState().transfers).toEqual([{ ...status, state: 'done', bytes: 10 }]);
    store.clearFinishedTransfers();
    expect(store.getState().transfers).toEqual([]);
  });

  it('사이드바 보기를 서버/파일로 바꾼다', () => {
    const { store } = files();
    store.setSideView('files');
    expect(store.getState().ui).toMatchObject({ sideView: 'files', sidebarOpen: true });
  });
});

describe('AppStore 탭 그룹 (F3.10a)', () => {
  async function three() {
    let n = 0;
    const api = new FakeBtTermApi().on('session.openQuick', () => ({ sessionId: `s${++n}` }));
    let g = 0;
    const store = new AppStore(api, { ids: () => `n${++g}` });
    for (const host of ['a', 'b', 'c']) await store.openQuick(host, 22, 'u');
    return { api, store };
  }
  const groups = (store: AppStore) =>
    allGroups(store.getState().layout)
      .map((g) => g.tabs.join(','))
      .join('|');

  it('새 탭은 활성 칸에 열린다', async () => {
    const { store } = await three();
    expect(groups(store)).toBe('s1,s2,s3');
    expect(store.getState().activeId).toBe('s3');
  });

  it('AC33 탭을 칸 가장자리에 놓으면 새 칸이 생기고 그 탭이 활성', async () => {
    const { store } = await three();
    store.startTabDrag('s1');
    expect(store.getState().ui.draggingTab).toBe('s1');
    store.dropTab(allGroups(store.getState().layout)[0]!.id, 'right');
    expect(groups(store)).toBe('s2,s3|s1');
    expect(store.getState().activeId).toBe('s1');
    expect(store.getState().ui.draggingTab).toBeNull();

    // 새 연결은 활성 칸에
    await store.openQuick('d', 22, 'u');
    expect(groups(store)).toBe('s2,s3|s1,s4');
  });

  it('칸 가운데·탭바에 놓으면 그 칸으로 옮기고, 빈 칸은 사라진다', async () => {
    const { store } = await three();
    store.splitTab('s1', 'right');
    const [left, right] = allGroups(store.getState().layout);
    store.startTabDrag('s2');
    store.dropTab(right!.id, 'center');
    expect(groups(store)).toBe('s3|s1,s2');
    store.startTabDrag('s3');
    store.dropTabOnBar(allGroups(store.getState().layout)[1]!.id);
    expect(groups(store)).toBe('s1,s2,s3');
    expect(left).toBeDefined();
  });

  it('F3.1 탭을 다른 탭 위에 놓으면 그 자리로 옮긴다(다른 칸이면 그 칸으로)', async () => {
    const { store } = await three();
    store.startTabDrag('s3');
    store.dropTabOnTab('s1');
    expect(groups(store)).toBe('s3,s1,s2');
    store.startTabDrag('s3');
    store.dropTabOnTab('s2');
    expect(groups(store)).toBe('s1,s2,s3');
    store.splitTab('s3', 'right');
    store.startTabDrag('s1');
    store.dropTabOnTab('s3');
    expect(groups(store)).toBe('s2|s1,s3');
  });

  it('칸의 마지막 탭을 닫으면 칸이 사라지고 남은 칸이 활성', async () => {
    const { api, store } = await three();
    store.splitTab('s3', 'right');
    store.closeTab('s3');
    expect(groups(store)).toBe('s1,s2');
    expect(store.getState().activeId).toBe('s2');
    expect(api.requestsOf('session.close')).toEqual([{ type: 'session.close', sessionId: 's3' }]);
  });

  it('같은 서버를 여는 동안 다른 칸으로 옮겨도 원래 탭의 칸 옆에 연다(리뷰 5)', async () => {
    const { api, store } = await three();
    store.splitTab('s3', 'right');
    const left = allGroups(store.getState().layout)[0]!.id;
    api.on('session.openQuick', () => ({ sessionId: 's9' }));
    const opening = store.openBeside('s1', 'bottom');
    store.activate('s3');
    await opening;
    const layout = store.getState().layout;
    expect(groups(store)).toBe('s1,s2|s9|s3');
    expect(layout.root.kind === 'split' && layout.root.children[0]?.kind).toBe('split');
    expect(allGroups(layout).some((g) => g.id === left)).toBe(true);
  });

  it('칸 합치기는 모든 탭을 활성 칸 하나로 모은다', async () => {
    const { store } = await three();
    store.splitTab('s1', 'bottom');
    store.mergeGroups();
    expect(groups(store)).toBe('s2,s3,s1');
    expect(store.getState().activeId).toBe('s1');
  });

  it('이미 닫힌 탭이나 끄는 탭 없이 놓으면 무시한다', async () => {
    const { store } = await three();
    const id = allGroups(store.getState().layout)[0]!.id;
    store.dropTab(id, 'right');
    store.startTabDrag('s3');
    store.closeTab('s3');
    store.dropTab(id, 'right');
    expect(groups(store)).toBe('s1,s2');
  });

  it('자기 칸 가운데에 놓기는 무시한다', async () => {
    const { store } = await three();
    store.startTabDrag('s1');
    store.dropTab(allGroups(store.getState().layout)[0]!.id, 'center');
    expect(groups(store)).toBe('s1,s2,s3');
  });

  it('활성 칸이 바뀌면 찾기창을 닫는다', async () => {
    const { store } = await three();
    store.splitTab('s1', 'right');
    store.setFindOpen(true);
    store.activate('s3');
    expect(store.getState().ui.findOpen).toBe(false);
  });

  it('탭을 고르면 그 칸이 활성이 된다', async () => {
    const { store } = await three();
    store.splitTab('s1', 'right');
    store.activate('s2');
    expect(store.getState().layout.focused).toBe(allGroups(store.getState().layout)[0]!.id);
    expect(store.getState().activeId).toBe('s2');
  });
});

describe('AppStore 서버 상태 (F3.18)', () => {
  const stats = {
    os: 'Ubuntu',
    user: 'root',
    cpuPercent: 10,
    mem: null,
    net: null,
    uptimeSec: 60,
    disk: null,
  };

  it('AC34 세션 상태를 읽어 세션별로 두고, 겹친 요청은 하나만 보낸다', async () => {
    let n = 0;
    const api = new FakeBtTermApi()
      .on('session.openQuick', () => ({ sessionId: `s${++n}` }))
      .on('stats.read', () => ({ status: 'ok', stats }));
    const store = new AppStore(api);
    await store.openQuick('h', 22, 'u');
    await Promise.all([store.readStats('s1'), store.readStats('s1')]);
    expect(api.requestsOf('stats.read')).toHaveLength(1);
    expect(store.getState().stats['s1']).toEqual(stats);
  });

  it('읽지 못하면 이전 값을 유지하고, 탭을 닫으면 지운다', async () => {
    let ok = true;
    const api = new FakeBtTermApi()
      .on('session.openQuick', () => ({ sessionId: 's1' }))
      .on('stats.read', () => (ok ? { status: 'ok', stats } : { status: 'unavailable' }));
    const store = new AppStore(api);
    await store.openQuick('h', 22, 'u');
    await store.readStats('s1');
    ok = false;
    await store.readStats('s1');
    expect(store.getState().stats['s1']).toEqual(stats);
    store.closeTab('s1');
    expect(store.getState().stats['s1']).toBeUndefined();
  });
});
