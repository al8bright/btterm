import { describe, expect, it } from 'vitest';
import { mainWindowOptions } from './windowOptions';

describe('SEC-7 메인 창 webPreferences', () => {
  it('격리·샌드박스·노드 통합 끔·webview 끔을 고정한다', () => {
    expect(
      mainWindowOptions('C:/app/preload.js', { packaged: false, dark: true, platform: 'windows' })
        .webPreferences,
    ).toEqual({
      preload: 'C:/app/preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: true,
      additionalArguments: ['--btterm-platform=windows'],
    });
  });

  it('출시(패키징) 빌드에서는 DevTools를 끈다', () => {
    expect(
      mainWindowOptions('p', { packaged: true, dark: true, platform: 'windows' }).webPreferences
        ?.devTools,
    ).toBe(false);
  });

  it('F6.7 복원할 위치가 있으면 그 위치·크기로, 없으면 기본 1280×800', () => {
    const bounds = { x: 10, y: 20, width: 1400, height: 900 };
    expect(
      mainWindowOptions('p', { packaged: true, dark: true, platform: 'windows', bounds }),
    ).toMatchObject(bounds);
    const fresh = mainWindowOptions('p', { packaged: true, dark: true, platform: 'windows' });
    expect(fresh).toMatchObject({ width: 1280, height: 800 });
    expect(fresh.x).toBeUndefined();
  });

  it('최소 창 크기는 960×600(DESIGN §4.1)', () => {
    expect(
      mainWindowOptions('p', { packaged: true, dark: true, platform: 'windows' }),
    ).toMatchObject({
      minWidth: 960,
      minHeight: 600,
    });
  });

  it('DESIGN §4.2 Windows는 창 버튼을 헤더 오른쪽에 겹친다', () => {
    const options = mainWindowOptions('p', { packaged: true, dark: true, platform: 'windows' });
    expect(options.titleBarStyle).toBe('hidden');
    expect(options.titleBarOverlay).toMatchObject({ height: 46 });
    expect(options.trafficLightPosition).toBeUndefined();
  });

  it('DESIGN §4.2 macOS는 hiddenInset + 헤더 48 세로 가운데 신호등, 겹침 없음', () => {
    const options = mainWindowOptions('p', { packaged: true, dark: true, platform: 'mac' });
    expect(options.titleBarStyle).toBe('hiddenInset');
    expect(options.trafficLightPosition).toEqual({ x: 16, y: 17 });
    expect(options.titleBarOverlay).toBeUndefined();
    expect(options.webPreferences).toEqual({
      preload: 'p',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: false,
      additionalArguments: ['--btterm-platform=mac'],
    });
  });
});
