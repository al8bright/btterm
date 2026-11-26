import type { IconRef } from '@btterm/core';
import { Icon, type IconName } from './Icon';

/** 고를 수 있는 내장 서버 아이콘 21종(F1.11, DESIGN §2.6) */
export const SERVER_ICONS = [
  'server',
  'web',
  'database',
  'container',
  'router',
  'cloud',
  'terminal',
  'monitor',
  'laptop',
  'cpu',
  'storage',
  'shield',
  'lock',
  'mail',
  'code',
  'branch',
  'network',
  'chart',
  'flask',
  'home',
  'bolt',
] as const satisfies readonly IconName[];
export type ServerIconName = (typeof SERVER_ICONS)[number];

/** 아이콘 색 팔레트(DESIGN §2.6). 저장값은 이름, 색은 토큰 --icon-color-<이름> */
export const ICON_COLORS = [
  'blue',
  'cyan',
  'teal',
  'green',
  'lime',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
] as const;
export type IconColor = (typeof ICON_COLORS)[number];

export function isServerIcon(name: string): name is ServerIconName {
  return (SERVER_ICONS as readonly string[]).includes(name);
}

export function isIconColor(color: string | undefined): color is IconColor {
  return color !== undefined && (ICON_COLORS as readonly string[]).includes(color);
}

/**
 * 아이콘 타일 24×24(DESIGN §2.6). 색은 팔레트 이름만 받아 CSS 토큰으로 칠한다.
 * 저장 파일에서 온 값을 스타일에 그대로 넣지 않는다(모르는 값은 기본 색).
 */
export function ServerIcon({ icon, size = 14 }: { icon: IconRef | undefined; size?: number }) {
  const name: IconName = icon?.kind === 'builtin' && isServerIcon(icon.name) ? icon.name : 'server';
  const color = icon?.kind === 'builtin' && isIconColor(icon.color) ? icon.color : undefined;
  return (
    <span className="icon-tile" data-icon={name} data-color={color} aria-hidden="true">
      <Icon name={name} size={size} />
    </span>
  );
}
