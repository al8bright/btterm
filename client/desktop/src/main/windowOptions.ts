import { platformArg, type KeymapPlatform, type Rect } from '@btterm/core';
import type { BrowserWindowConstructorOptions } from 'electron';
import { CHROME_COLORS, titleBarOverlay } from './windowChrome';

/** 신호등(높이 약 14) 위쪽 끝. 헤더 48의 세로 가운데에 오게 한다 */
const MAC_TRAFFIC_LIGHTS = { x: 16, y: 17 };

/**
 * SEC-7 기본선을 적용한 메인 창 옵션. 출시 빌드는 DevTools를 끈다.
 * 기본 제목 표시줄을 숨기고 Windows는 창 버튼을 헤더 오른쪽에 겹치고, macOS는 신호등을
 * 헤더 왼쪽 세로 가운데에 둔다(DESIGN §4.2).
 */
export function mainWindowOptions(
  preloadPath: string,
  {
    packaged,
    dark,
    platform,
    bounds,
  }: { packaged: boolean; dark: boolean; platform: KeymapPlatform; bounds?: Rect | undefined },
): BrowserWindowConstructorOptions {
  return {
    // F6.7: 지난번 위치·내용 영역 크기(화면 안일 때만, restoreBounds), 없으면 기본 크기로 가운데
    ...(bounds ? { ...bounds, useContentSize: true } : { width: 1280, height: 800 }),
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'btterm',
    ...(platform === 'mac'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: MAC_TRAFFIC_LIGHTS }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(dark) }),
    // 저장된 화면 모드의 바탕색으로 띄워 라이트에서 어두운 화면이 비치지 않게 한다
    backgroundColor: CHROME_COLORS[dark ? 'dark' : 'light'].base,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !packaged,
      // renderer가 키맵·창 크롬을 고르는 OS 플래그. sandbox preload는 platform 모듈을 쓸 수 없다
      additionalArguments: [platformArg(platform)],
    },
  };
}
