import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
} from 'electron';
import {
  MainToRendererEventSchema,
  RendererToMainRequestSchema,
  restoreBounds,
} from '@btterm/core';
import sessionHostPath from '../session-host/index?modulePath';
import { IPC } from '../shared/api';
import { uiPlatform, userKnownHostsPath } from '../platform/paths';
import { AppRequests } from './AppRequests';
import { APP_SCHEME, CONTENT_SECURITY_POLICY, resolveAppPath } from './appProtocol';
import { openExternalUrl } from './external/openExternal';
import { KnownHostsStore } from './hostkeys/KnownHostsStore';
import { AppLogger } from './logging/AppLogger';
import { SessionBroker } from './SessionBroker';
import { ProfileRepository } from './store/ProfileRepository';
import { SettingsRepository } from './store/SettingsRepository';
import { removeObsoleteFiles } from './store/obsoleteFiles';
import { ensureUpgradeSnapshot } from './store/upgradeSnapshot';
import { electronSafeStorage } from './vault/electronSafeStorage';
import { SecretVault, VaultUnavailableError } from './vault/SecretVault';
import {
  devRendererUrl,
  insecureKeyStoreSwitch,
  isTrustedSender,
  userDataOverride,
} from './devEnv';
import { createMainWindow, paintWindowChrome, trackNormalContentBounds } from './window';
import { isDarkUi } from './windowChrome';
import { appMenuTemplate } from './appMenu';

// E2E·개발 빌드는 별도 userData를 쓴다(AGENTS §6). 단일 인스턴스 락보다 먼저 정해야 한다.
const userDataDir = userDataOverride(process.env, app.isPackaged);
if (userDataDir) app.setPath('userData', userDataDir);

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// SEC-8: Electron 기본 메뉴(Ctrl+W 닫기, Ctrl+R 새로고침 등)를 쓰지 않는다. macOS는 표준 역할만.
const menuTemplate = appMenuTemplate(uiPlatform());
Menu.setApplicationMenu(menuTemplate ? Menu.buildFromTemplate(menuTemplate) : null);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  const userData = app.getPath('userData');

  // F6.10: 마이그레이션·저장소 접근 전에 업그레이드 스냅샷을 먼저 찍는다.
  const { snapshot } = await ensureUpgradeSnapshot({
    dataDir: userData,
    appVersion: app.getVersion(),
    now: Date.now(),
  });
  // 제거한 계정·동기화(F8)가 남긴 파일(감싼 계정 키·토큰)을 지운다
  await removeObsoleteFiles(userData);
  const logger = await AppLogger.open(join(userData, 'logs'));
  await logger.info('앱 시작', { version: app.getVersion(), snapshot });

  // D9·SEC-2: safeStorage를 쓸 수 없거나 고정 키 저장소 스위치로 실행됐으면 비밀 저장 기능을 끈다(평문 폴백 없음).
  const insecureSwitch = insecureKeyStoreSwitch(
    (name) => app.commandLine.hasSwitch(name),
    app.isPackaged,
  );
  if (insecureSwitch)
    await logger.warn('안전하지 않은 키 저장소 스위치 — 비밀 저장 비활성', {
      switch: insecureSwitch,
    });
  const vault = insecureSwitch
    ? null
    : await SecretVault.open(join(userData, 'vault.json'), electronSafeStorage, () =>
        randomUUID(),
      ).catch(async (error: unknown) => {
        if (!(error instanceof VaultUnavailableError)) throw error;
        await logger.warn('비밀 보관소 사용 불가 — 비밀 저장 비활성');
        return null;
      });
  const repo = await ProfileRepository.open(join(userData, 'profiles.json'));
  if (repo.recoveredFromBackup) await logger.warn('프로필 저장소를 백업에서 복구');
  const settings = await SettingsRepository.open(join(userData, 'settings.json'));
  // 창 제목 표시줄(헤더 오른쪽 창 버튼)은 화면 모드를 따른다(DESIGN §4.2)
  const darkUi = () => isDarkUi(settings.current.ui.theme, nativeTheme.shouldUseDarkColors);
  let win: BrowserWindow | null = null;
  const repaint = () => {
    if (win) paintWindowChrome(win, darkUi());
  };
  const appRequests = new AppRequests({
    settings,
    onSettingsChanged: repaint,
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: (text) => clipboard.writeText(text),
    },
    openExternal: openExternalUrl,
  });

  const rendererDir = join(__dirname, '../renderer');
  protocol.handle(APP_SCHEME, async (request) => {
    const target = resolveAppPath(rendererDir, request.url);
    if (!target) return new Response('not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(target).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, headers });
  });

  // SEC-7: 권한 요청은 모두 거부한다. 클립보드는 main을 거친다.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  const knownHosts = new KnownHostsStore(join(userData, 'known_hosts'), userKnownHostsPath());
  const broker = new SessionBroker({
    sessionHostPath,
    knownHosts,
    repo,
    vault,
    logger,
    editDir: join(userData, 'edit'),
  });

  // F6.6: 절전 복귀·잠금 해제 뒤 죽은 연결을 찾아 재접속을 유도한다.
  powerMonitor.on('resume', () => broker.probeAll());
  powerMonitor.on('unlock-screen', () => broker.probeAll());

  ipcMain.handle(IPC.invoke, async (event, raw: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url, devRendererUrl(process.env, app.isPackaged))) {
      throw new Error('신뢰할 수 없는 발신자');
    }
    const request = RendererToMainRequestSchema.parse(raw);
    if (appRequests.handles(request)) return appRequests.handle(request);
    return broker.handle(event.sender, request);
  });

  // F4.3 끌어 놓은 파일 경로(preload 전용 단방향 채널)
  ipcMain.on(IPC.dropped, (event, path: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url, devRendererUrl(process.env, app.isPackaged)))
      return;
    if (typeof path === 'string' && path.length > 0 && path.length <= 4096) {
      broker.registerDropped(event.sender, path);
    }
  });

  // F6.7: 지난번 창 위치·크기. 그 자리가 지금 연결된 화면 밖이면 기본 위치(결정 DF2)
  const saved = settings.current.window;
  const restored = saved
    ? restoreBounds(
        saved.bounds,
        screen.getAllDisplays().map((d) => d.workArea),
      )
    : undefined;
  const main = createMainWindow(join(__dirname, '../preload/index.js'), {
    dark: darkUi(),
    bounds: restored,
    maximized: saved?.maximized ?? false,
  });
  win = main;
  const normalBounds = trackNormalContentBounds(main, restored);
  // macOS 전체 화면에서는 신호등이 숨으므로 헤더 여백을 되돌리게 알린다(DESIGN §4.2)
  const sendFullScreen = (fullScreen: boolean) =>
    main.webContents.send(
      IPC.event,
      MainToRendererEventSchema.parse({ type: 'window.fullScreen', fullScreen }),
    );
  main.on('enter-full-screen', () => sendFullScreen(true));
  main.on('leave-full-screen', () => sendFullScreen(false));
  let savingWindow: Promise<unknown> = Promise.resolve();
  main.on('close', () => {
    savingWindow = settings
      .saveWindow({ bounds: normalBounds(), maximized: main.isMaximized() })
      .catch((error: unknown) => logger.warn('창 상태 저장 실패', { error: String(error) }));
  });
  // app.quit() 경로에서는 window-all-closed가 오지 않으므로, 끝나기 전에 창 상태 저장을 기다린다
  let flushed = false;
  app.on('will-quit', (event) => {
    if (flushed) return;
    event.preventDefault();
    // 저장 장치가 멈춰도 종료는 막지 않는다(최대 2초, 보안 리뷰 L3)
    const limit = new Promise((resolve) => setTimeout(resolve, 2000));
    void Promise.race([savingWindow, limit]).finally(() => {
      flushed = true;
      app.quit();
    });
  });
  nativeTheme.on('updated', repaint);
  app.on('second-instance', () => {
    if (main.isMinimized()) main.restore();
    main.focus();
  });
  app.on('window-all-closed', () => {
    broker.dispose();
    void Promise.all([savingWindow, logger.info('앱 종료')]).finally(() => app.quit());
  });
}
