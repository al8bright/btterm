import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, defaultAppSettings } from './appSettings';
import { restoreBounds } from './windowState';

const display = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('창 위치·크기 복원(F6.7, 결정 DF2)', () => {
  it('저장된 위치가 연결된 화면 안이면 그대로 쓴다(두 번째 모니터 포함)', () => {
    const bounds = { x: 2000, y: 100, width: 1400, height: 900 };
    expect(restoreBounds(bounds, [display, second])).toEqual(bounds);
  });

  it('모니터를 떼서 저장된 위치가 화면 밖이면 기본 위치(undefined)', () => {
    expect(restoreBounds({ x: 2000, y: 100, width: 1400, height: 900 }, [display])).toBeUndefined();
  });

  it('제목 표시줄(헤더)을 잡을 수 없을 만큼만 걸쳐 있으면 기본 위치', () => {
    // 위쪽 48px 띠가 화면과 겹치는 폭이 100px 미만
    expect(restoreBounds({ x: 1870, y: 100, width: 1200, height: 800 }, [display])).toBeUndefined();
    // 창 위쪽이 화면 위로 벗어남
    expect(restoreBounds({ x: 100, y: -200, width: 1200, height: 800 }, [display])).toBeUndefined();
  });

  it('최소 창 크기(960×600)보다 작게 저장돼 있으면 최소 크기로 올린다', () => {
    expect(restoreBounds({ x: 10, y: 10, width: 400, height: 300 }, [display])).toEqual({
      x: 10,
      y: 10,
      width: 960,
      height: 600,
    });
  });

  it('터무니없이 큰 좌표·크기(손상된 파일)는 기본 위치', () => {
    expect(restoreBounds({ x: 10, y: 10, width: 1e9, height: 800 }, [display])).toBeUndefined();
    expect(restoreBounds({ x: -1e9, y: 10, width: 1200, height: 800 }, [display])).toBeUndefined();
  });

  it('창 상태만 잘못돼 있으면 그 값만 버리고 나머지 설정은 지킨다(보안 리뷰 M1)', () => {
    const settings = {
      ...defaultAppSettings(),
      terminal: { ...defaultAppSettings().terminal, fontSize: 18 },
      window: { bounds: { x: 0, y: 0, width: 0, height: 700 }, maximized: false },
    };
    const parsed = AppSettingsSchema.parse(settings);
    expect(parsed.window).toBeUndefined();
    expect(parsed.terminal.fontSize).toBe(18);
  });

  it('창 상태는 설정 파일의 선택 필드다(없어도 기존 파일이 열린다)', () => {
    expect(AppSettingsSchema.safeParse(defaultAppSettings()).success).toBe(true);
    const withWindow = {
      ...defaultAppSettings(),
      window: { bounds: { x: 1, y: 2, width: 1000, height: 700 }, maximized: true },
    };
    expect(AppSettingsSchema.parse(withWindow).window?.maximized).toBe(true);
  });
});
