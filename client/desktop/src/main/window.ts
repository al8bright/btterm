import type { Rect } from '@btterm/core';
import { app, BrowserWindow } from 'electron';
import { APP_ORIGIN } from './appProtocol';
import { devRendererUrl } from './devEnv';
import { CHROME_COLORS, titleBarOverlay } from './windowChrome';
import { mainWindowOptions } from './windowOptions';
import { uiPlatform } from '../platform/paths';

interface MainWindowState {
  /** 시작할 때의 화면 모드 */
  dark: boolean;
  /** 복원할 위치·크기(F6.7). 없으면 기본 */
  bounds?: Rect | undefined;
  maximized?: boolean;
}

/** SEC-7 기본선을 적용한 메인 창 */
export function createMainWindow(preloadPath: string, state: MainWindowState): BrowserWindow {
  const win = new BrowserWindow(
    mainWindowOptions(preloadPath, {
      packaged: app.isPackaged,
      dark: state.dark,
      platform: uiPlatform(),
      bounds: state.bounds,
    }),
  );

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    win.show();
    // 배율(150% 등)에서는 바깥 크기가 반올림돼 실행할 때마다 1px씩 커진다. 내용 영역으로 정확히 맞춘다.
    if (state.bounds) win.setContentBounds(state.bounds);
    if (state.maximized) win.maximize();
  });

  const devUrl = devRendererUrl(process.env, app.isPackaged);
  void (devUrl ? win.loadURL(devUrl) : win.loadURL(`${APP_ORIGIN}/index.html`));
  return win;
}

/**
 * 최대화·최소화가 아닐 때의 내용 영역 위치·크기를 따라간다(F6.7). 최대화한 채로 꺼도
 * 다음에 최대화를 풀면 그 크기로 돌아가게 한다. 바깥 크기는 배율에서 반올림되므로 내용 영역을 쓴다.
 */
export function trackNormalContentBounds(win: BrowserWindow, initial?: Rect): () => Rect {
  let last = initial ?? win.getContentBounds();
  const update = () => {
    if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
    last = win.getContentBounds();
  };
  win.on('resize', update);
  win.on('move', update);
  return () => {
    update();
    return last;
  };
}

/** 화면 모드가 바뀌면 헤더 오른쪽 창 버튼과 바탕색을 다시 칠한다(DESIGN §4.2) */
export function paintWindowChrome(win: BrowserWindow, dark: boolean): void {
  if (win.isDestroyed()) return;
  try {
    win.setTitleBarOverlay(titleBarOverlay(dark));
  } catch {
    // macOS(M2)는 창 버튼 겹침 색을 지원하지 않는다. 설정 저장은 그대로 성공시킨다.
  }
  win.setBackgroundColor(CHROME_COLORS[dark ? 'dark' : 'light'].base);
}
