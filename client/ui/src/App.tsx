import { Fragment, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  countSavedTabs,
  isPaneScoped,
  isTerminalScoped,
  matchShortcut,
  type AppAction,
  type BtTermApi,
  type KeymapPlatform,
  type PaneDirection,
} from '@btterm/core';
import { ServicesProvider, useAppState, useRegistry, useShortcut, useStore } from './app/context';
import { ActivityBar } from './components/ActivityBar';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { FindBar } from './components/FindBar';
import { QuickConnect } from './components/QuickConnect';
import { Dialogs } from './components/Dialogs';
import { DropZone } from './components/DropZone';
import { AppLogo } from './components/AppLogo';
import { EditChanges } from './components/EditChanges';
import { isModalOpen } from './components/Modal';
import { ServerCards } from './components/ServerCards';
import { ServerTree } from './components/ServerTree';
import { SftpPanel } from './components/SftpPanel';
import { StatsBar } from './components/StatsBar';
import { Toast } from './components/Toast';
import { SessionTabs } from './components/SessionTabs';
import { StatusBar } from './components/StatusBar';
import { TerminalView } from './components/TerminalView';
import { ToolPanel } from './components/ToolPanel';
import { PromptDialog } from './PromptDialog';
import { t, type MessageKey } from './i18n';
import { AppStore, type Notice } from './store/AppStore';
import type { EngineFactory } from './terminal/TerminalEngine';
import { TerminalRegistry } from './terminal/TerminalRegistry';
import { XtermEngine } from './terminal/XtermEngine';
import {
  allGroups,
  findSplit,
  sharesOf,
  type LayoutNode,
  type PaneGroup,
  type SplitNode,
} from './workspace/groupLayout';

interface AppProps {
  api: BtTermApi;
  platform?: KeymapPlatform;
  /** 테스트에서 가짜 엔진을 넣는다 */
  createEngine?: EngineFactory;
}

/** 앱 진입점: store·터미널 레지스트리를 만들고 수명을 관리한다. */
export function App({ api, platform = 'windows', createEngine }: AppProps) {
  const [services] = useState(() => {
    const store = new AppStore(api);
    let dispatch: (action: AppAction) => void = () => undefined;
    const registry = new TerminalRegistry({
      api,
      platform,
      createEngine: createEngine ?? ((hooks) => new XtermEngine(hooks)),
      onAction: (action) => dispatch(action),
      onLink: (url) => void store.openLink(url),
      confirmPaste: (lineCount) => store.requestConfirm({ kind: 'paste', lineCount }),
      onCwd: (sessionId, path) => store.setCwd(sessionId, path),
      isAvailable: (action) => shortcutAvailable(store, action),
      sessionEnded: (sessionId) => {
        const state = store.getState().tabs.find((tab) => tab.sessionId === sessionId)?.state;
        return state === 'failed' || state === 'closed';
      },
    });
    return { store, registry, platform, setDispatch: (fn: typeof dispatch) => (dispatch = fn) };
  });

  useEffect(() => {
    services.store.start();
    if (__BTTERM_E2E__) {
      // E2E 빌드 전용 버퍼 읽기 훅(AGENTS §6). 출시 빌드에서는 제거된다.
      window.__bttermTest = {
        bufferText: (id) => services.registry.bufferText(id),
        receivedBytes: (id) => services.registry.receivedBytes(id),
      };
    }
    return () => {
      services.store.dispose();
      services.registry.disposeAll();
    };
  }, [services]);

  return (
    <ServicesProvider value={services}>
      <AppShell platform={platform} setDispatch={services.setDispatch} />
    </ServicesProvider>
  );
}

const REGIONS = [
  '.quick input',
  '.sidebar-search',
  '.tabbar[data-focused="true"] .tab[aria-selected="true"]',
  '.terminal-host[data-active="true"] textarea',
  '.toolpanel input, .toolpanel button',
];

function AppShell({
  platform,
  setDispatch,
}: {
  platform: KeymapPlatform;
  setDispatch(fn: (action: AppAction) => void): void;
}) {
  const store = useStore();
  const registry = useRegistry();
  const quickRef = useRef<HTMLInputElement>(null);
  const tabs = useAppState((s) => s.tabs);
  const activeId = useAppState((s) => s.activeId);
  const sidebarOpen = useAppState((s) => s.ui.sidebarOpen);
  const fullScreen = useAppState((s) => s.fullScreen);
  const sideView = useAppState((s) => s.ui.sideView);
  const terminalSettings = useAppState((s) => s.settings?.terminal);
  // 명령 팔레트(F5.1b): 팔레트에서 고른 동작은 단축키와 같은 경로로 실행한다
  const [paletteOpen, setPaletteOpen] = useState(false);
  const runAction = useRef<(action: AppAction) => void>(() => undefined);

  // 화면 모드(F5.3): <html data-theme>로 토큰 값을 바꾼다. system이면 OS 설정이 바뀔 때 따라간다.
  const uiTheme = useAppState((s) => s.settings?.ui.theme ?? 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (uiTheme !== 'system') {
      root.dataset.theme = uiTheme;
      return;
    }
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    const apply = () => (root.dataset.theme = query?.matches ? 'light' : 'dark');
    apply();
    query?.addEventListener('change', apply);
    return () => query?.removeEventListener('change', apply);
  }, [uiTheme]);

  // 설정의 터미널 기본값을 모든 터미널에 적용(F3.16 "전체 기본값")
  useEffect(() => {
    if (terminalSettings) registry.applyDefaults(terminalSettings);
  }, [registry, terminalSettings]);

  // 닫힌 탭의 터미널 정리(AC13). 닫힌 탭에 있던 포커스가 body로 떨어지지 않게 옮긴다(결정 UX5).
  const tabCount = useRef(tabs.length);
  useEffect(() => {
    const open = new Set(tabs.map((tab) => tab.sessionId));
    for (const id of registry.sessionIds()) if (!open.has(id)) registry.dispose(id);
    const closed = tabs.length < tabCount.current;
    tabCount.current = tabs.length;
    if (!closed || isModalOpen()) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (activeId) registry.focus(activeId);
    else if (tabs.length === 0) quickRef.current?.focus();
  }, [registry, tabs, activeId]);

  // 단축키 동작(DESIGN §8.1). 터미널 안에서 눌린 키는 레지스트리가 먼저 처리한다.
  useEffect(() => {
    const run = (action: AppAction) => {
      const active = store.getState().activeId;
      switch (action) {
        case 'commandPalette':
          setPaletteOpen(true);
          return;
        case 'quickConnect':
        case 'newTab':
          // 이미 포커스가 있으면 focus 이벤트가 오지 않으므로 한 번 떼었다 붙여 목록을 연다
          quickRef.current?.blur();
          quickRef.current?.focus();
          return;
        case 'splitSameServer':
          if (active) void store.openBeside(active, 'right');
          return;
        case 'closeTab':
          if (active) store.closeTab(active);
          return;
        case 'nextTab':
          store.cycleTab(1);
          return;
        case 'prevTab':
          store.cycleTab(-1);
          return;
        case 'toggleSidebar':
          store.toggleSidebar();
          return;
        case 'focusSftp':
          store.setSideView('files');
          return;
        case 'toggleToolPanel':
          store.toggleToolPanel();
          return;
        case 'historySearch':
          if (store.getState().ui.toolPanel !== 'history') store.toggleToolPanel('history');
          return;
        case 'findInTerminal':
          if (active) store.setFindOpen(true);
          return;
        case 'reconnect':
          if (active) store.reconnect(active);
          return;
        case 'cycleRegionForward':
        case 'cycleRegionBackward':
          cycleRegion(action === 'cycleRegionForward' ? 1 : -1);
          return;
        default:
          runPaneAction(store, action);
          return;
      }
    };
    setDispatch(run);
    runAction.current = run;
    const onKeyDown = (event: KeyboardEvent) => {
      // 대화상자가 열려 있으면 뒤쪽 화면의 단축키는 쉰다(결정 UX5)
      if (event.defaultPrevented || isModalOpen()) return;
      const action = matchShortcut(event, platform);
      // 터미널 전용 동작은 TerminalRegistry가 처리한다. 입력칸의 Cmd+C/V 등은 그대로 둔다(보안 리뷰 M1)
      if (!action || isTerminalScoped(action) || !shortcutAvailable(store, action)) return;
      event.preventDefault();
      run(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, platform, setDispatch]);

  return (
    <div className="app" data-platform={platform} data-fullscreen={fullScreen}>
      <header className="header">
        <span className="brand">
          <AppLogo size={20} />
          {t('app.name')}
        </span>
        <QuickConnect ref={quickRef} />
      </header>
      <EditChanges />
      <div className="body">
        <ActivityBar />
        {sidebarOpen && (sideView === 'files' ? <SftpPanel /> : <ServerTree />)}
        <div className="main">
          <Workspace activeId={activeId} onNewTab={() => quickRef.current?.focus()} />
        </div>
      </div>
      <StatusBar />
      {paletteOpen && (
        <CommandPalette
          platform={platform}
          onAction={(action) => runAction.current(action)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      <PromptQueue />
      <Dialogs />
      <Toast />
      <ConfirmDialog />
    </div>
  );
}

/** 작업 영역: 칸(탭 그룹) 1~8개를 담은 분할 나무. 칸마다 탭바 + 터미널(F3.10a, DESIGN §5.4b). */
function Workspace({ activeId, onNewTab }: { activeId: string | null; onNewTab(): void }) {
  const store = useStore();
  const tabs = useAppState((s) => s.tabs);
  const layout = useAppState((s) => s.layout);
  const dragging = useAppState((s) => s.ui.draggingTab);
  const showDropZones =
    dragging !== null && tabs.length > 1 && tabs.some((t) => t.sessionId === dragging);

  // 끌기가 비정상으로 끝나 dragend를 못 받아도 다음 클릭에서 끌기 상태를 거둔다(놓기 영역·토스트).
  useEffect(() => {
    if (dragging === null) return;
    const clear = () => store.startTabDrag(null);
    window.addEventListener('mousedown', clear);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('mousedown', clear);
      window.removeEventListener('dragend', clear);
    };
  }, [store, dragging]);

  return (
    <main className="workspace">
      <LayoutView
        node={layout.root}
        pane={{
          focusedId: layout.focused,
          split: allGroups(layout).length > 1,
          activeId,
          showDropZone: showDropZones,
          onNewTab,
        }}
      />
    </main>
  );
}

/** 칸 공통 정보 */
interface PaneContext {
  focusedId: string;
  /** 칸이 여러 개인지(칸 테두리 표시) */
  split: boolean;
  activeId: string | null;
  showDropZone: boolean;
  onNewTab(): void;
}

/**
 * 분할 나무를 그린다: 묶음은 방향대로 나란히(비율 = flex-grow), 잎은 칸.
 * 자식 사이에는 끌거나 방향키로 비율을 바꾸는 경계를 둔다(F3.10b).
 */
function LayoutView({
  node,
  pane,
  share,
}: {
  node: LayoutNode;
  pane: PaneContext;
  share?: number | undefined;
}) {
  const style = share === undefined ? undefined : { flexGrow: share };
  if (node.kind === 'group') return <PaneGroupView group={node} pane={pane} style={style} />;
  const shares = sharesOf(node);
  return (
    <div className="split" data-axis={node.axis} style={style}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <SplitHandle split={node} border={i - 1} />}
          <LayoutView node={child} pane={pane} share={shares[i]} />
        </Fragment>
      ))}
    </div>
  );
}

/** 칸 경계(F3.10b): 끌면 비율이 바뀌고, 포커스한 뒤 방향키로 5%씩 옮긴다. */
function SplitHandle({ split, border }: { split: SplitNode; border: number }) {
  const store = useStore();
  const vertical = split.axis === 'row';
  const shares = sharesOf(split);
  const position = shares.slice(0, border + 1).reduce((sum, share) => sum + share, 0);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = {
      [vertical ? 'ArrowLeft' : 'ArrowUp']: -0.05,
      [vertical ? 'ArrowRight' : 'ArrowDown']: 0.05,
    }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    store.resizeSplit(split.id, border, step);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const box = handle.parentElement?.getBoundingClientRect();
    const size = (vertical ? box?.width : box?.height) ?? 0;
    if (size <= 0) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    const startPos = vertical ? event.clientX : event.clientY;
    const startShare = shares[border] ?? 0;
    let frame = 0;
    let pos = startPos;
    // 시작점 기준으로 계산해 최소 크기에 걸렸다 돌아올 때 어긋나지 않게 하고, 갱신은 프레임당 한 번
    const apply = () => {
      frame = 0;
      const target = startShare + (pos - startPos) / size;
      const current = findSplit(store.getState().layout.root, split.id);
      const now = current ? (sharesOf(current)[border] ?? startShare) : startShare;
      store.resizeSplit(split.id, border, target - now);
    };
    const move = (e: globalThis.PointerEvent) => {
      pos = vertical ? e.clientX : e.clientY;
      frame ||= requestAnimationFrame(apply);
    };
    const end = () => {
      cancelAnimationFrame(frame);
      if (frame) apply();
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        handle.removeEventListener(type, end);
      }
      handle.removeEventListener('pointermove', move);
      delete handle.dataset.dragging;
    };
    handle.dataset.dragging = 'true';
    handle.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      handle.addEventListener(type, end);
    }
  };

  return (
    <div
      className="split-handle"
      role="separator"
      tabIndex={0}
      aria-label={t('split.handle')}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position * 100)}
      data-axis={split.axis}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}

function PaneGroupView({
  group,
  pane,
  style,
}: {
  group: PaneGroup;
  pane: PaneContext;
  style?: { flexGrow: number } | undefined;
}) {
  const { activeId, showDropZone, onNewTab, split } = pane;
  const focused = group.id === pane.focusedId;
  // 탭 순서를 바꿔도 터미널 DOM이 움직이지 않도록 칸 안 렌더 순서는 고정한다.
  const views = [...group.tabs].sort();
  return (
    <section className="pane-group" data-focused={focused} style={style}>
      <SessionTabs group={group} focused={focused} onNewTab={onNewTab} />
      <div className="pane-body">
        <div className="pane-main">
          {focused && <SessionOverlays activeId={activeId} />}
          {group.tabs.length === 0 && <EmptyPane onQuick={onNewTab} />}
          {group.active && <ConnectingNotice sessionId={group.active} />}
          {views.map((id) => (
            <TerminalView
              key={id}
              sessionId={id}
              active={id === activeId}
              visible={id === group.active}
              split={split}
            />
          ))}
          {showDropZone && group.active && <DropZone groupId={group.id} />}
        </div>
        {focused && <ToolPanel />}
      </div>
      {group.tabs.length > 0 && <StatsBar sessionId={group.active} />}
    </section>
  );
}

/** 연결이 없을 때: 무엇을 하면 되는지와 바로 가는 버튼(UX 검토 U3) */
function EmptyPane({ onQuick }: { onQuick(): void }) {
  const store = useStore();
  const restore = useAppState((s) => s.restoreOffer);
  return (
    <div className="empty">
      {restore && (
        <button
          type="button"
          className="btn primary restore"
          onClick={() => void store.restoreSession()}
        >
          {t('empty.restore', { count: countSavedTabs(restore) })}
        </button>
      )}
      <strong>{t('empty.title')}</strong>
      <span>{t('empty.body')}</span>
      <div className="empty-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => store.openDialog({ kind: 'host', profileId: null })}
        >
          {t('empty.addServer')}
        </button>
        <button type="button" className="btn" onClick={onQuick}>
          {t('empty.quick', { key: useShortcut('quickConnect') })}
        </button>
      </div>
      <ServerCards />
    </div>
  );
}

/** 연결·인증 중에는 빈 검은 화면 대신 무엇을 하는지와 취소 버튼을 보여 준다(결정 UX6). */
function ConnectingNotice({ sessionId }: { sessionId: string }) {
  const store = useStore();
  const tab = useAppState((s) => s.tabs.find((x) => x.sessionId === sessionId));
  if (tab?.state !== 'connecting' && tab?.state !== 'authenticating') return null;
  const text = tab.state === 'connecting' ? 'session.connectingTo' : 'session.authenticatingTo';
  return (
    <div className="connecting" role="status">
      <span className={`dot ${tab.state}`} aria-hidden="true" />
      <span>{t(text, { target: tab.title })}</span>
      <button type="button" className="btn" onClick={() => store.closeTab(sessionId)}>
        {t('session.cancel')}
      </button>
    </div>
  );
}

/** 활성 칸 위 알림·끊김 배너·찾기(DESIGN §5.5). */
function SessionOverlays({ activeId }: { activeId: string | null }) {
  const store = useStore();
  const tabs = useAppState((s) => s.tabs);
  const notice = useAppState((s) => s.notice);
  const findOpen = useAppState((s) => s.ui.findOpen);
  const active = tabs.find((tab) => tab.sessionId === activeId);
  return (
    <div className="overlays">
      {notice && <NoticeBanner key={notice.key} notice={notice} />}
      {active?.state === 'reconnecting' && (
        <div className="banner info" role="status">
          {active.reconnect?.nextDelayMs != null
            ? t('session.reconnectingIn', {
                seconds: Math.ceil(active.reconnect.nextDelayMs / 1000),
                attempt: active.reconnect.attempt,
              })
            : t('session.reconnecting')}
          <button type="button" className="btn" onClick={() => store.reconnect(active.sessionId)}>
            {t('session.reconnectNow')}
          </button>
        </div>
      )}
      {(active?.state === 'failed' || active?.state === 'closed') && (
        <div className="banner" role="alert">
          {t(
            `error.${active.errorCode ?? (active.state === 'closed' ? 'closed' : 'unknown')}` as MessageKey,
          )}
          <span className="banner-keys">{t('session.endedKeys')}</span>
          <button type="button" className="btn" onClick={() => store.reconnect(active.sessionId)}>
            {t('session.reconnect')}
          </button>
        </div>
      )}
      {findOpen && activeId && <FindBar sessionId={activeId} />}
    </div>
  );
}

/** 성공·안내는 4초 뒤 사라지고, 오류는 닫을 때까지 남는다(결정 UX6). */
const NOTICE_MS = 4000;

function NoticeBanner({ notice }: { notice: Notice }) {
  const store = useStore();
  useEffect(() => {
    if (notice.tone === 'error') return;
    const timer = setTimeout(() => store.dismissNotice(), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [store, notice]);
  const error = notice.tone === 'error';
  return (
    <div className={error ? 'banner' : 'banner info'} role={error ? 'alert' : 'status'}>
      {t(notice.key)}
      <button type="button" className="btn" onClick={() => store.dismissNotice()}>
        {t('notice.dismiss')}
      </button>
    </div>
  );
}

function PromptQueue() {
  const store = useStore();
  const prompt = useAppState((s) => s.prompts[0]);
  if (!prompt) return null;
  return (
    <PromptDialog
      key={prompt.promptId}
      prompt={prompt.prompt}
      onRespond={(response) => store.respondPrompt(prompt.promptId, response)}
    />
  );
}

/** 칸 조작 키는 칸이 2개 이상일 때만 앱이 쓴다(결정 UX2). 아니면 터미널로 보낸다. */
function shortcutAvailable(store: AppStore, action: AppAction): boolean {
  return !isPaneScoped(action) || store.paneCount() > 1;
}

/** 탭 번호·칸 포커스·칸 크기 단축키(F3.10b) */
function runPaneAction(store: AppStore, action: AppAction): void {
  const tab = /^goToTab([1-9])$/.exec(action);
  if (tab) {
    store.goToTab(Number(tab[1]));
    return;
  }
  const pane = /^(focus|resize)Pane(Left|Right|Up|Down)$/.exec(action);
  if (!pane) return;
  const direction = pane[2] as PaneDirection;
  if (pane[1] === 'focus') store.focusPane(direction);
  else store.nudgePane(direction);
}

/** F6 영역 순환(DESIGN §9): 터미널은 Tab을 소비하므로 F6이 유일한 탈출 경로다. */
function cycleRegion(step: 1 | -1): void {
  const targets = REGIONS.map((selector) => document.querySelector<HTMLElement>(selector)).filter(
    (el): el is HTMLElement => el !== null,
  );
  if (targets.length === 0) return;
  const current = targets.findIndex((el) => el.contains(document.activeElement));
  const next = targets[(current + step + targets.length) % targets.length];
  next?.focus();
}
