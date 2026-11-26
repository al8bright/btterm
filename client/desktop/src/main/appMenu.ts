import type { KeymapPlatform } from '@btterm/core';
import type { MenuItemConstructorOptions } from 'electron';

/**
 * SEC-8: Electron 기본 메뉴를 쓰지 않는다. Windows는 메뉴가 없다(Ctrl+문자는 터미널로).
 * macOS는 메뉴가 없으면 입력칸의 Cmd+C/V와 Cmd+Q가 동작하지 않으므로 표준 역할만 골라 둔다.
 * reload·DevTools·zoom·창 닫기(Cmd+W = 탭 닫기, DESIGN §8.1)는 넣지 않는다.
 * 앱 동작(새 탭 등)의 단축키는 renderer 키맵이 처리한다.
 */
export function appMenuTemplate(platform: KeymapPlatform): MenuItemConstructorOptions[] | null {
  if (platform !== 'mac') return null;
  return [
    {
      label: 'btterm',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];
}
