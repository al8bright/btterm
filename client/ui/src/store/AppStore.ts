import {
  AppSettingsSchema,
  ProfilesViewSchema,
  HistoryResultSchema,
  StatsResultSchema,
  type AppSettings,
  type BtTermApi,
  type FilesOp,
  type Group,
  type HistoryResult,
  type KnownHostView,
  type HostDefaults,
  type MainToRendererEvent,
  type Profile,
  type ProfilesView,
  type Prompt,
  type PromptResponse,
  type RendererToMainRequest,
  type ServerStats,
  type SessionState,
  type TerminalSettings,
  type TransferStatus,
  type TreeItemRef,
  type SavedNode,
  type Snippet,
  type UiTheme,
  type PaneDirection,
} from '@btterm/core';
import { messageFor, type MessageKey } from '../i18n';
import {
  activateTab,
  activeSession,
  addTab,
  allGroups,
  allowedSpots,
  cycleTab,
  focusNeighbor,
  goToTab,
  groupOf,
  initialLayout,
  MAX_GROUPS,
  mergeAll,
  moveTab,
  nudgeFocused,
  removeTab,
  resizeSplit,
  splitTab,
  type DropSpot,
  type DropSide,
  type GroupLayout,
} from '../workspace/groupLayout';
import { rebuildLayout, savedTabsInOrder, snapshotSession } from '../workspace/sessionRestore';

export interface TabState {
  sessionId: string;
  title: string;
  profileId?: string;
  state: SessionState;
  errorCode?: string;
  reconnect?: {
    attempt: number;
    nextDelayMs: number | null;
  };
  /** 사용자가 바꾼 탭 이름(F3.1b). 이 실행 동안만 */
  customTitle?: string;
  /** 빠른 연결로 연 탭(F1.3 저장 토스트용) */
  quick?: { host: string; port: number; username: string };
  /** 저장 토스트를 이미 띄웠는지 */
  offeredSave?: boolean;
  /** OSC 7로 받은 원격 현재 폴더(F4.5) */
  cwd?: string;
}

export type DialogState =
  | { kind: 'host'; profileId: string | null; groupId?: string | null }
  | { kind: 'group'; groupId: string | null; parentId?: string | null }
  | { kind: 'keys' }
  | { kind: 'keyAdd' }
  | { kind: 'knownHosts' };

export interface ToastState {
  kind: 'saveQuick';
  sessionId: string;
  host: string;
  port: number;
  username: string;
}

export type IdentityInput =
  | { mode: 'none' }
  | { mode: 'existing'; identityId: string }
  | {
      mode: 'new';
      label: string;
      username: string;
      auth: Extract<RendererToMainRequest, { type: 'profiles.saveIdentity' }>['auth'];
    };

export interface HostInput {
  profileId: string | null;
  name: string;
  host: string;
  groupId: string | null;
  overrides: Omit<HostDefaults, 'identityId'>;
  tags: string[];
  identity: IdentityInput;
}

export type KeyRequest = Extract<
  RendererToMainRequest,
  { type: 'keys.addFromPath' | 'keys.importText' | 'keys.generate' }
>;
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export interface Notice {
  key: MessageKey;
  tone: 'info' | 'error';
}

const SESSION_SAVE_DELAY_MS = 300;

interface StoreOptions {
  ids?: () => string;
  now?: () => number;
}

export type ToolPanelTab = 'design' | 'history' | 'snippets';

export interface UiState {
  sidebarOpen: boolean;
  toolPanel: ToolPanelTab | null;
  /** 마지막으로 연 도구 패널 탭(F3.15: 다시 열 때 기억) */
  lastToolPanel: ToolPanelTab;
  findOpen: boolean;
  /** 사이드바 내용: 서버 목록 / 원격 파일(F4.1) */
  sideView: 'servers' | 'files';
  /** 끌고 있는 탭(F3.10a) */
  draggingTab: string | null;
}

export type ConfirmRequest =
  | { kind: 'paste'; lineCount: number }
  | { kind: 'link'; url: string }
  | { kind: 'delete'; name: string }
  | { kind: 'move'; name: string }
  | { kind: 'shellInstall' }
  /** production 서버에서 sudo 스니펫 실행(F3.14) */
  | { kind: 'sudo'; name: string };

export interface AppState {
  tabs: TabState[];
  activeId: string | null;
  profiles: ProfilesView | null;
  /** sessionId: 세션에 딸린 확인창(그 탭을 닫으면 내린다, DF1) */
  prompts: Array<{ promptId: string; prompt: Prompt; sessionId?: string }>;
  /** 칸 위 알림(결정 UX6): info는 잠시 뒤 사라지고 error는 닫을 때까지 남는다 */
  notice: Notice | null;
  ui: UiState;
  settings: AppSettings | null;
  confirm: ConfirmRequest | null;
  history: (HistoryResult & { sessionId: string }) | null;
  dialog: DialogState | null;
  toast: ToastState | null;
  transfers: TransferStatus[];
  /** 창이 전체 화면인가(macOS 신호등 여백, DESIGN §4.2) */
  fullScreen: boolean;
  /** 로컬에서 편집하다 저장된 파일(F4.8). 업로드·무시하면 빠진다 */
  editChanges: Array<{ editId: string; sessionId: string; name: string }>;
  /** 지난번 종료 때의 탭(F6.9). 탭을 하나라도 열면 사라진다 */
  restoreOffer: SavedNode | null;
  /** 칸(탭 그룹) 배치(F3.10a). activeId = 활성 칸의 선택 탭 */
  layout: GroupLayout;
  /** 세션별 서버 상태(F3.18). 메모리에만 둔다 */
  stats: Record<string, ServerStats>;
}

const initialState: AppState = {
  tabs: [],
  activeId: null,
  profiles: null,
  prompts: [],
  restoreOffer: null,
  editChanges: [],
  fullScreen: false,
  notice: null,
  ui: {
    sidebarOpen: true,
    toolPanel: null,
    lastToolPanel: 'design',
    findOpen: false,
    sideView: 'servers',
    draggingTab: null,
  },
  settings: null,
  confirm: null,
  history: null,
  dialog: null,
  toast: null,
  transfers: [],
  layout: initialLayout('main'),
  stats: {},
};

/**
 * renderer 상태(DESIGN §11). React 밖에서 상태를 갖고 useSyncExternalStore로 구독한다.
 * 터미널 바이트는 여기를 거치지 않는다(TerminalRegistry가 직접 받는다).
 */
export class AppStore {
  #state: AppState = initialState;
  readonly #listeners = new Set<() => void>();
  #unsubscribe: (() => void) | null = null;
  #confirmResolve: ((ok: boolean) => void) | null = null;
  readonly #statsInFlight = new Map<string, Promise<void>>();

  readonly #ids: () => string;
  readonly #now: () => number;

  #sessionTimer: ReturnType<typeof setTimeout> | undefined;
  /** 마지막으로 저장한 lastSession(JSON). 같으면 다시 쓰지 않는다 */
  #savedSession = 'null';

  constructor(
    private readonly api: BtTermApi,
    options: StoreOptions = {},
  ) {
    this.#ids = options.ids ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => Date.now());
  }

  getState = (): AppState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(): void {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.api.onEvent((event) => this.#onEvent(event));
    void this.api.invoke({ type: 'profiles.get' }).then((raw) => {
      const parsed = ProfilesViewSchema.safeParse(raw);
      if (parsed.success) this.#set({ profiles: parsed.data });
    });
    void this.api.invoke({ type: 'settings.get' }).then((raw) => {
      const parsed = AppSettingsSchema.safeParse(raw);
      if (!parsed.success) return;
      const { sidebarOpen, toolPanel, lastToolPanel } = parsed.data.ui;
      this.#savedSession = JSON.stringify(parsed.data.lastSession ?? null);
      if (parsed.data.lastSession && this.#state.tabs.length === 0) {
        this.#set({ restoreOffer: parsed.data.lastSession });
      }
      this.#set({
        settings: parsed.data,
        ui: { ...this.#state.ui, sidebarOpen, toolPanel, lastToolPanel },
      });
    });
  }

  /** 화면 모드(F5.3): 바로 반영하고 설정 파일에 남긴다 */
  async setUiTheme(theme: UiTheme): Promise<void> {
    const settings = this.#state.settings;
    if (settings) this.#set({ settings: { ...settings, ui: { ...settings.ui, theme } } });
    const raw = await this.api.invoke({ type: 'settings.update', patch: { ui: { theme } } });
    const parsed = AppSettingsSchema.safeParse(raw);
    if (parsed.success) this.#set({ settings: parsed.data });
  }

  /** 스니펫(F3.14, DF7): 바로 반영하고 목록을 통째로 설정 파일에 남긴다 */
  async saveSnippets(snippets: Snippet[]): Promise<void> {
    const settings = this.#state.settings;
    if (settings) this.#set({ settings: { ...settings, snippets } });
    const raw = await this.api.invoke({ type: 'settings.update', patch: { snippets } });
    const parsed = AppSettingsSchema.safeParse(raw);
    if (parsed.success) this.#set({ settings: parsed.data });
  }

  async updateTerminalDefaults(patch: Partial<TerminalSettings>): Promise<void> {
    const raw = await this.api.invoke({ type: 'settings.update', patch: { terminal: patch } });
    const parsed = AppSettingsSchema.safeParse(raw);
    if (parsed.success) this.#set({ settings: parsed.data });
  }

  /** 확인창(F3.9 여러 줄 붙여넣기, SEC-6 링크). 한 번에 하나만 띄우고 이전 것은 거절로 끝낸다. */
  requestConfirm(request: ConfirmRequest): Promise<boolean> {
    this.#confirmResolve?.(false);
    return new Promise((resolve) => {
      this.#confirmResolve = resolve;
      this.#set({ confirm: request });
    });
  }

  resolveConfirm(ok: boolean): void {
    const resolve = this.#confirmResolve;
    this.#confirmResolve = null;
    this.#set({ confirm: null });
    resolve?.(ok);
  }

  async openLink(url: string): Promise<void> {
    if (await this.requestConfirm({ kind: 'link', url })) {
      await this.api.invoke({ type: 'link.open', url });
    }
  }

  /** F3.17a: 활성 세션의 원격 셸 기록을 읽는다. */
  async loadHistory(): Promise<void> {
    const sessionId = this.#state.activeId;
    if (!sessionId) return;
    const raw = await this.api.invoke({ type: 'history.load', sessionId });
    const parsed = HistoryResultSchema.safeParse(raw);
    const result = parsed.success ? parsed.data : { status: 'unavailable' as const, entries: [] };
    this.#set({ history: { sessionId, ...result } });
  }

  /** F3.18: 세션 서버 상태를 읽는다. 겹친 요청은 하나로, 못 읽으면 이전 값을 둔다. */
  readStats(sessionId: string): Promise<void> {
    const running = this.#statsInFlight.get(sessionId);
    if (running) return running;
    const request = this.api
      .invoke({ type: 'stats.read', sessionId })
      .then((raw) => {
        const parsed = StatsResultSchema.safeParse(raw);
        if (!parsed.success || parsed.data.status !== 'ok') return;
        if (!this.#state.tabs.some((t) => t.sessionId === sessionId)) return;
        this.#set({ stats: { ...this.#state.stats, [sessionId]: parsed.data.stats } });
      })
      .catch(() => undefined)
      .finally(() => this.#statsInFlight.delete(sessionId));
    this.#statsInFlight.set(sessionId, request);
    return request;
  }

  openDialog(dialog: DialogState): void {
    this.#set({ dialog });
  }

  closeDialog(): void {
    this.#set({ dialog: null });
  }

  /** F1.1: 서버 저장. 새 Identity가 있으면 먼저 저장한다(비밀번호는 main으로만 간다). */
  async saveHost(input: HostInput): Promise<ActionResult> {
    let identityId: string | undefined;
    if (input.identity.mode === 'existing') identityId = input.identity.identityId;
    if (input.identity.mode === 'new') {
      const result = (await this.api.invoke({
        type: 'profiles.saveIdentity',
        identity: { label: input.identity.label, username: input.identity.username },
        auth: input.identity.auth,
      })) as { identityId?: string; error?: string };
      if (!result.identityId) return { ok: false, error: result.error ?? 'unknown' };
      identityId = result.identityId;
    }
    const existing = this.#profile(input.profileId);
    const profile: Profile = {
      ...existing,
      id: existing?.id ?? this.#ids(),
      groupId: input.groupId,
      name: input.name,
      host: input.host,
      overrides: { ...input.overrides, ...(identityId !== undefined ? { identityId } : {}) },
      tags: input.tags,
      updatedAt: this.#now(),
    };
    return this.#mutate({ type: 'profiles.saveProfile', profile }, profile.id);
  }

  deleteProfile(profileId: string): Promise<ActionResult> {
    return this.#mutateReported({ type: 'profiles.deleteProfile', profileId });
  }

  async togglePin(profileId: string): Promise<ActionResult> {
    const profile = this.#profile(profileId);
    if (!profile) return { ok: false, error: 'no-profile' };
    return this.#mutateReported({
      type: 'profiles.saveProfile',
      profile: { ...profile, pinned: !profile.pinned },
    });
  }

  saveGroup(group: Omit<Group, 'id' | 'order'> & { id: string | null }): Promise<ActionResult> {
    const existing = this.#state.profiles?.groups.find((g) => g.id === group.id);
    const id = group.id ?? this.#ids();
    const order = existing?.order ?? this.#nextOrder(group.parentId);
    return this.#mutate({ type: 'profiles.saveGroup', group: { ...group, id, order } }, id);
  }

  /** 서버 트리 끌어 놓기(F1.2a). 순서 재계산·저장은 main이 한 번에 한다(DND3). */
  moveTreeItem(item: TreeItemRef, parentId: string | null, index: number): Promise<ActionResult> {
    return this.#mutateReported({ type: 'profiles.move', item, parentId, index });
  }

  /** 같은 단계 맨 끝 순서(그룹·서버가 한 순서를 공유, DND1) */
  #nextOrder(parentId: string | null): number {
    const view = this.#state.profiles;
    const orders = [
      ...(view?.groups.filter((g) => g.parentId === parentId) ?? []),
      ...(view?.profiles.filter((p) => p.groupId === parentId) ?? []),
    ].flatMap((item) => (item.order === undefined ? [] : [item.order]));
    return orders.length > 0 ? Math.max(...orders) + 1 : 0;
  }

  deleteGroup(groupId: string): Promise<ActionResult> {
    return this.#mutateReported({ type: 'profiles.deleteGroup', groupId });
  }

  async addKey(request: KeyRequest): Promise<ActionResult> {
    const result = (await this.api.invoke(request)) as { keyId?: string; error?: string };
    return result.keyId
      ? { ok: true, id: result.keyId }
      : { ok: false, error: result.error ?? 'unknown' };
  }

  /** F2.4b: 알려진 호스트 목록 */
  async loadKnownHosts(): Promise<KnownHostView[]> {
    const result = (await this.api.invoke({ type: 'knownHosts.list' })) as {
      entries?: KnownHostView[];
    };
    return result.entries ?? [];
  }

  /** btterm 파일의 항목만 지운다. 그사이 파일이 바뀌었으면 false */
  async removeKnownHost(entry: KnownHostView): Promise<boolean> {
    const result = (await this.api.invoke({
      type: 'knownHosts.remove',
      line: entry.line,
      keyType: entry.keyType,
      key: entry.key,
    })) as { ok?: boolean };
    return result.ok === true;
  }

  /** F7.8: 연결된 세션의 서버에 공개키를 등록한다. added=false면 이미 있었다 */
  async installKey(keyId: string, sessionId: string): Promise<ActionResult & { added?: boolean }> {
    const result = (await this.api.invoke({ type: 'keys.install', keyId, sessionId })) as {
      ok?: boolean;
      result?: { added?: boolean };
      error?: string;
    };
    return result.ok
      ? { ok: true, added: result.result?.added === true }
      : { ok: false, error: result.error ?? 'unknown' };
  }

  /** F7.7: 보관소 키를 파일로 내보낸다. 저장 위치는 main의 대화상자에서 고른다 */
  async exportKey(keyId: string): Promise<ActionResult & { exported?: boolean }> {
    const result = (await this.api.invoke({ type: 'keys.export', keyId })) as {
      exported?: boolean;
      error?: string;
    };
    return result.error
      ? { ok: false, error: result.error }
      : { ok: true, exported: result.exported === true };
  }

  deleteKey(keyId: string): Promise<ActionResult> {
    return this.#mutate({ type: 'keys.delete', keyId });
  }

  /** F1.3: 빠른 연결한 대상을 서버로 저장한다. 비밀번호는 저장하지 않는다. */
  async saveQuickTarget(): Promise<void> {
    const toast = this.#state.toast;
    if (!toast) return;
    this.#set({ toast: null });
    const result = await this.saveHost({
      profileId: null,
      name: toast.host,
      host: toast.host,
      groupId: null,
      overrides: { port: toast.port, username: toast.username },
      tags: [],
      identity: { mode: 'none' },
    });
    if (result.ok) this.#notify('toast.saved', 'info');
  }

  async filesOp(
    sessionId: string,
    op: FilesOp,
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const result = (await this.api.invoke({ type: 'files.op', sessionId, op })) as {
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    return result.ok
      ? { ok: true, result: result.result }
      : { ok: false, error: result.error ?? 'unknown' };
  }

  download(sessionId: string, remotePaths: string[]): Promise<ActionResult> {
    return this.#mutate({ type: 'files.download', sessionId, remotePaths });
  }

  upload(sessionId: string, remoteDir: string, localPaths?: string[]): Promise<ActionResult> {
    return this.#mutate({
      type: 'files.upload',
      sessionId,
      remoteDir,
      ...(localPaths && localPaths.length > 0 ? { localPaths } : {}),
    });
  }

  /** F4.7: 폴더 선택 창으로 고른 폴더를 올린다 */
  uploadFolder(sessionId: string, remoteDir: string): Promise<ActionResult> {
    return this.#mutate({ type: 'files.upload', sessionId, remoteDir, pick: 'folder' });
  }

  /** F4.8: 원격 파일을 로컬 기본 앱으로 연다. 열 수 없으면 이유를 알린다 */
  async editLocal(sessionId: string, remotePath: string): Promise<void> {
    const result = (await this.api.invoke({ type: 'files.editLocal', sessionId, remotePath })) as {
      ok: boolean;
      error?: string;
    };
    if (!result.ok)
      this.#notify(messageFor('error', result.error ?? '', 'error.edit-failed'), 'error');
  }

  /** 로컬에서 고친 파일을 원래 자리에 올린다(사용자가 누를 때만) */
  uploadEdit(editId: string): void {
    void this.api.invoke({ type: 'files.editUpload', editId });
    this.dismissEdit(editId);
  }

  dismissEdit(editId: string): void {
    this.#set({ editChanges: this.#state.editChanges.filter((e) => e.editId !== editId) });
  }

  /** TR2: 실패한 전송을 남은 부분 파일에서 잇는다 */
  retryTransfer(transferId: string): void {
    void this.api.invoke({ type: 'transfer.retry', transferId });
  }

  cancelTransfer(transferId: string): void {
    void this.api.invoke({ type: 'transfer.cancel', transferId });
  }

  clearFinishedTransfers(): void {
    // 실패한 전송은 남은 부분 파일도 지운다(TR2)
    for (const transfer of this.#state.transfers) {
      if (transfer.state === 'failed') {
        void this.api.invoke({ type: 'transfer.discard', transferId: transfer.id });
      }
    }
    this.#set({
      transfers: this.#state.transfers.filter((t) => t.state === 'queued' || t.state === 'running'),
    });
  }

  setCwd(sessionId: string, cwd: string): void {
    this.#set({
      tabs: this.#state.tabs.map((tab) => (tab.sessionId === sessionId ? { ...tab, cwd } : tab)),
    });
  }

  setSideView(sideView: 'servers' | 'files'): void {
    this.#setUi({ sideView, sidebarOpen: true });
  }

  /** 끌어 놓은 파일의 로컬 경로(F4.3) */
  pathForFile(file: unknown): string {
    return this.api.pathForFile(file);
  }

  async copyText(text: string): Promise<void> {
    await this.api.invoke({ type: 'clipboard.writeText', text });
  }

  dismissToast(): void {
    this.#set({ toast: null });
  }

  #notify(key: MessageKey, tone: Notice['tone']): void {
    this.#set({ notice: { key, tone } });
  }

  /** 대화상자 밖(트리 메뉴·끌어 놓기)에서 한 변경은 실패를 알림으로 올린다 */
  async #mutateReported(request: RendererToMainRequest): Promise<ActionResult> {
    const result = await this.#mutate(request);
    if (!result.ok) this.#notify('notice.saveFailed', 'error');
    return result;
  }

  async #mutate(request: RendererToMainRequest, id?: string): Promise<ActionResult> {
    const result = (await this.api.invoke(request)) as { ok?: boolean; error?: string };
    if (result.ok === false) return { ok: false, error: result.error ?? 'unknown' };
    return id !== undefined ? { ok: true, id } : { ok: true };
  }

  #profile(profileId: string | null): Profile | undefined {
    return profileId ? this.#state.profiles?.profiles.find((p) => p.id === profileId) : undefined;
  }

  setFindOpen(open: boolean): void {
    this.#setUi({ findOpen: open });
  }

  dispose(): void {
    clearTimeout(this.#sessionTimer);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** 연 세션 id(실패하면 null) */
  async openQuick(host: string, port: number, username: string): Promise<string | null> {
    const result = (await this.api.invoke({ type: 'session.openQuick', host, port, username })) as {
      sessionId: string | null;
      error?: string;
    };
    if (result.sessionId) {
      this.#addTab({
        sessionId: result.sessionId,
        title: `${username}@${host}`,
        quick: { host, port, username },
      });
      return result.sessionId;
    }
    if (result.error !== 'cancelled') {
      // 조용히 끝나면 사용자는 Enter가 안 먹힌 줄 안다(UX 검토 C)
      this.#notify(messageFor('error', result.error ?? '', 'error.open-failed'), 'error');
    }
    return null;
  }

  /** 연 세션 id(실패·취소하면 null) */
  async openProfile(profileId: string): Promise<string | null> {
    const result = (await this.api.invoke({ type: 'session.openProfile', profileId })) as {
      sessionId?: string;
      error?: string;
    };
    if (result.sessionId) {
      const name = this.#state.profiles?.profiles.find((p) => p.id === profileId)?.name;
      this.#addTab({ sessionId: result.sessionId, title: name ?? profileId, profileId });
      return result.sessionId;
    }
    if (result.error !== 'cancelled') {
      this.#notify(messageFor('error', result.error ?? '', 'error.open-failed'), 'error');
    }
    return null;
  }

  async importSshConfig(): Promise<void> {
    const result = (await this.api.invoke({ type: 'import.sshConfig' })) as { created?: number };
    this.#notify(result.created ? 'sidebar.imported' : 'sidebar.importNone', 'info');
  }

  activate(sessionId: string): void {
    this.#setLayout(activateTab(this.#state.layout, sessionId));
  }

  startTabDrag(sessionId: string | null): void {
    this.#setUi({ draggingTab: sessionId });
  }

  /** F3.10a: 끌고 있는 탭을 칸 터미널 위에 놓는다. 가장자리 = 새 칸, 가운데 = 그 칸으로. */
  dropTab(groupId: string, spot: DropSpot): void {
    const dragged = this.#takeDragged();
    const { layout } = this.#state;
    if (!dragged || !allowedSpots(layout, groupId, dragged).includes(spot)) return;
    this.#setLayout(
      spot === 'center'
        ? moveTab(layout, dragged, groupId)
        : splitTab(layout, dragged, groupId, spot, this.#ids()),
    );
  }

  /** 끌고 있는 탭을 target 탭 자리로 옮긴다(다른 칸이면 그 칸으로, F3.1). */
  dropTabOnTab(target: string): void {
    const dragged = this.#takeDragged();
    const { layout } = this.#state;
    const group = groupOf(layout, target);
    if (!dragged || !group || dragged === target) return;
    this.#setLayout(moveTab(layout, dragged, group.id, group.tabs.indexOf(target)));
  }

  /** 끌고 있는 탭을 칸 탭바의 빈 곳(맨 끝)에 놓는다. */
  dropTabOnBar(groupId: string): void {
    const dragged = this.#takeDragged();
    if (dragged) this.#setLayout(moveTab(this.#state.layout, dragged, groupId));
  }

  /** 탭 메뉴: 탭을 자기 칸 옆 새 칸으로. */
  splitTab(sessionId: string, side: DropSide): void {
    const { layout } = this.#state;
    const group = groupOf(layout, sessionId);
    if (group) this.#setLayout(splitTab(layout, sessionId, group.id, side, this.#ids()));
  }

  /**
   * 같은 서버를 sessionId 칸 옆에 새로 연다(F3.10b, 결정 UX4). 저장된 서버면 그 프로필로,
   * 빠른 연결이면 같은 주소로 연다(비밀번호는 renderer에 없으므로 다시 묻는다, SEC-1).
   */
  async openBeside(sessionId: string, side: DropSide): Promise<void> {
    const tab = this.#state.tabs.find((x) => x.sessionId === sessionId);
    if (!tab || this.paneCount() >= MAX_GROUPS) return;
    this.activate(sessionId);
    const opened = tab.profileId
      ? await this.openProfile(tab.profileId)
      : tab.quick
        ? await this.openQuick(tab.quick.host, tab.quick.port, tab.quick.username)
        : null;
    // 비밀번호를 다시 묻는 사이 포커스가 다른 칸으로 갔어도 원래 탭이 있는 칸 옆에 연다(리뷰 5)
    const { layout } = this.#state;
    const target = groupOf(layout, sessionId);
    if (opened && target) this.#setLayout(splitTab(layout, opened, target.id, side, this.#ids()));
  }

  /** 칸 경계를 끌어 비율을 바꾼다(F3.10b) */
  resizeSplit(splitId: string, border: number, delta: number): void {
    this.#setLayout(resizeSplit(this.#state.layout, splitId, border, delta));
  }

  /** Ctrl+Alt+Shift+방향키 */
  nudgePane(direction: PaneDirection): void {
    this.#setLayout(nudgeFocused(this.#state.layout, direction));
  }

  /** Ctrl+Alt+방향키 */
  focusPane(direction: PaneDirection): void {
    this.#setLayout(focusNeighbor(this.#state.layout, direction));
  }

  /** Ctrl+Shift+1~9 */
  goToTab(n: number): void {
    this.#setLayout(goToTab(this.#state.layout, n));
  }

  paneCount(): number {
    return allGroups(this.#state.layout).length;
  }

  mergeGroups(): void {
    this.#setLayout(mergeAll(this.#state.layout));
  }

  cycleTab(step: 1 | -1): void {
    this.#setLayout(cycleTab(this.#state.layout, step));
  }

  /** F3.1b: 탭 이름 바꾸기. 빈 이름이면 원래 이름으로 */
  renameTab(sessionId: string, name: string): void {
    const customTitle = name.trim();
    this.#set({
      tabs: this.#state.tabs.map((tab) => {
        if (tab.sessionId !== sessionId) return tab;
        const next = { ...tab };
        if (customTitle && customTitle !== tab.title) next.customTitle = customTitle;
        else delete next.customTitle;
        return next;
      }),
    });
  }

  closeTab(sessionId: string): void {
    const { tabs } = this.#state;
    if (!tabs.some((t) => t.sessionId === sessionId)) return;
    void this.api.invoke({ type: 'session.close', sessionId });
    const stats = { ...this.#state.stats };
    delete stats[sessionId];
    // 그 세션의 확인창도 내린다. main이 세션 종료로 취소하므로 따로 답하지 않는다(DF1)
    this.#setLayout(removeTab(this.#state.layout, sessionId), {
      tabs: tabs.filter((t) => t.sessionId !== sessionId),
      stats,
      prompts: this.#state.prompts.filter((p) => p.sessionId !== sessionId),
      editChanges: this.#state.editChanges.filter((e) => e.sessionId !== sessionId),
    });
  }

  /** 끌던 탭을 꺼내고 끌기 상태를 끝낸다. 그 사이 닫힌 탭이면 null. */
  #takeDragged(): string | null {
    const dragged = this.#state.ui.draggingTab;
    this.#setUi({ draggingTab: null });
    return dragged && this.#state.tabs.some((t) => t.sessionId === dragged) ? dragged : null;
  }

  #setLayout(layout: GroupLayout, patch: Partial<AppState> = {}): void {
    if (layout === this.#state.layout && Object.keys(patch).length === 0) return;
    // 찾기창은 활성 칸 기준이라 칸이 바뀌면 닫는다.
    const ui =
      layout.focused !== this.#state.layout.focused
        ? { ...this.#state.ui, findOpen: false }
        : this.#state.ui;
    this.#set({ ...patch, layout, ui, activeId: activeSession(layout) });
    this.#persistSession();
  }

  reconnect(sessionId: string): void {
    void this.api.invoke({ type: 'session.reconnect', sessionId });
  }

  respondPrompt(promptId: string, response: PromptResponse): void {
    void this.api.invoke({ type: 'prompt.respond', promptId, response });
    this.#set({ prompts: this.#state.prompts.filter((p) => p.promptId !== promptId) });
  }

  dismissNotice(): void {
    this.#set({ notice: null });
  }

  toggleSidebar(): void {
    this.#setUi({ sidebarOpen: !this.#state.ui.sidebarOpen });
    this.#saveUi();
  }

  /** 같은 탭을 다시 고르면 닫는다. null이면 마지막 탭으로 열고 닫기를 토글한다. */
  toggleToolPanel(tab?: ToolPanelTab): void {
    const { toolPanel, lastToolPanel } = this.#state.ui;
    const target = tab ?? lastToolPanel;
    if (toolPanel === target) this.#setUi({ toolPanel: null });
    else this.#setUi({ toolPanel: target, lastToolPanel: target });
    this.#saveUi();
  }

  /** F3.15: 패널 열림·마지막 탭은 설정 파일에 남긴다(localStorage 금지, DESIGN §11). */
  #saveUi(): void {
    const { sidebarOpen, toolPanel, lastToolPanel } = this.#state.ui;
    void this.api.invoke({
      type: 'settings.update',
      patch: { ui: { sidebarOpen, toolPanel, lastToolPanel } },
    });
  }

  #addTab(tab: Omit<TabState, 'state'>): void {
    this.#setLayout(addTab(this.#state.layout, tab.sessionId), {
      tabs: [...this.#state.tabs, { ...tab, state: 'connecting' }],
      notice: null,
      restoreOffer: null,
    });
  }

  /**
   * F6.9: 지난번 탭을 칸 순서대로 다시 열고 칸 배치를 되살린다. 빠른 연결은 비밀번호를 다시 묻는다.
   * 자동으로 하지 않고 사용자가 누를 때만(결정 DF8).
   */
  async restoreSession(): Promise<void> {
    const saved = this.#state.restoreOffer;
    if (!saved) return;
    this.#set({ restoreOffer: null });
    const opened: Array<string | null> = [];
    for (const tab of savedTabsInOrder(saved)) {
      opened.push(
        'profileId' in tab
          ? await this.openProfile(tab.profileId)
          : await this.openQuick(tab.quick.host, tab.quick.port, tab.quick.username),
      );
    }
    // 다시 여는 사이 닫힌 탭은 빼고, 그 사이 따로 연 탭은 활성 칸에 붙인다
    const open = new Set(this.#state.tabs.map((tab) => tab.sessionId));
    let layout = rebuildLayout(
      saved,
      opened.map((id) => (id && open.has(id) ? id : null)),
      this.#ids,
    );
    if (!layout) return;
    const placed = new Set(allGroups(layout).flatMap((group) => group.tabs));
    for (const id of open) if (!placed.has(id)) layout = addTab(layout, id);
    this.#setLayout(layout);
  }

  /** 칸 배치·탭이 바뀌면 잠시 뒤 설정에 남긴다(칸 경계를 끄는 동안 매 프레임 쓰지 않게) */
  #persistSession(): void {
    // 시작 직후 지난번 기록을 빈 배치로 덮지 않는다
    if (this.#state.tabs.length === 0 && this.#state.restoreOffer) return;
    clearTimeout(this.#sessionTimer);
    this.#sessionTimer = setTimeout(() => {
      const snapshot = snapshotSession(this.#state.layout, this.#state.tabs);
      const json = JSON.stringify(snapshot);
      if (json === this.#savedSession) return;
      this.#savedSession = json;
      void this.api.invoke({ type: 'settings.update', patch: { lastSession: snapshot } });
    }, SESSION_SAVE_DELAY_MS);
  }

  #onEvent(event: MainToRendererEvent): void {
    switch (event.type) {
      case 'prompt.request':
        this.#set({
          prompts: [
            ...this.#state.prompts,
            {
              promptId: event.promptId,
              prompt: event.prompt,
              ...(event.sessionId ? { sessionId: event.sessionId } : {}),
            },
          ],
        });
        return;
      case 'window.fullScreen':
        this.#set({ fullScreen: event.fullScreen });
        return;
      case 'files.editChanged':
        if (!this.#state.editChanges.some((e) => e.editId === event.editId)) {
          this.#set({
            editChanges: [
              ...this.#state.editChanges,
              { editId: event.editId, sessionId: event.sessionId, name: event.name },
            ],
          });
        }
        return;
      case 'prompt.cancelled':
        this.#set({ prompts: this.#state.prompts.filter((p) => p.promptId !== event.promptId) });
        return;
      case 'profiles.changed':
        this.#set({ profiles: event.view });
        return;
      case 'transfer.status': {
        const others = this.#state.transfers.filter((t) => t.id !== event.status.id);
        const index = this.#state.transfers.findIndex((t) => t.id === event.status.id);
        const transfers = [...others];
        transfers.splice(index < 0 ? others.length : index, 0, event.status);
        this.#set({ transfers });
        return;
      }
      case 'session.state':
        this.#onSessionState(event);
        return;
    }
  }

  #onSessionState(event: Extract<MainToRendererEvent, { type: 'session.state' }>): void {
    let toast = this.#state.toast;
    const tabs = this.#state.tabs.map((tab) => {
      if (tab.sessionId !== event.sessionId) return tab;
      const next: TabState = { ...tab, state: event.state };
      delete next.errorCode;
      delete next.reconnect;
      if (event.errorCode) next.errorCode = event.errorCode;
      if (event.reconnect) next.reconnect = event.reconnect;
      if (event.state === 'ready' && tab.quick && !tab.offeredSave) {
        next.offeredSave = true;
        toast = { kind: 'saveQuick', sessionId: tab.sessionId, ...tab.quick };
      }
      return next;
    });
    this.#set({ tabs, toast });
  }

  #setUi(patch: Partial<UiState>): void {
    this.#set({ ui: { ...this.#state.ui, ...patch } });
  }

  #set(patch: Partial<AppState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of [...this.#listeners]) listener();
  }
}
