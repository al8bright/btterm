import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { appMenuTemplate } from './appMenu';

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}

describe('SEC-8 앱 메뉴', () => {
  it('Windows는 메뉴를 두지 않는다(Ctrl+문자는 터미널로)', () => {
    expect(appMenuTemplate('windows')).toBeNull();
  });

  it('macOS는 종료·숨기기와 입력칸 편집(복사·붙여넣기)만 표준 역할로 둔다', () => {
    const roles = flatten(appMenuTemplate('mac') ?? []).map((item) => item.role);
    expect(roles).toEqual(
      expect.arrayContaining(['quit', 'hide', 'copy', 'paste', 'cut', 'selectAll', 'minimize']),
    );
  });

  it('macOS 메뉴에 reload·DevTools·zoom·창 닫기(Cmd+W)·기본 서브메뉴 역할이 없다', () => {
    const items = flatten(appMenuTemplate('mac') ?? []);
    const forbidden = [
      'reload',
      'forceReload',
      'toggleDevTools',
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'close',
      'fileMenu',
      'viewMenu',
      'editMenu',
      'windowMenu',
      'appMenu',
    ];
    expect(items.filter((item) => forbidden.includes(item.role ?? ''))).toEqual([]);
    expect(items.every((item) => item.accelerator === undefined)).toBe(true);
  });
});
