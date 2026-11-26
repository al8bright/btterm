import type { UiTheme } from '@btterm/core';

/**
 * 창 크롬 색(DESIGN §4.2). main은 CSS를 읽을 수 없어 tokens.css 값을 복사해 둔다.
 * base = --surface-base, chrome = --surface-chrome, symbol = --text-secondary (windowChrome.test가 동기화를 검사).
 */
export const CHROME_COLORS = {
  dark: { base: '#0F1115', chrome: '#13161B', symbol: '#C9CED6' },
  light: { base: '#FFFFFF', chrome: '#EEF0F3', symbol: '#3B424B' },
} as const;

/** 헤더 48 − 아래 구분선 2. 버튼 밑에서 구분선이 끊기지 않게 한다. */
const TITLE_BAR_HEIGHT = 46;

/** 화면 모드가 system이거나 없으면 OS 설정을 따른다(F5.3). */
export function isDarkUi(theme: UiTheme | undefined, systemDark: boolean): boolean {
  if (theme === 'light') return false;
  if (theme === 'dark') return true;
  return systemDark;
}

/** Windows가 헤더 오른쪽에 그리는 최소화·최대화·닫기 버튼의 높이와 색 */
export function titleBarOverlay(dark: boolean): {
  height: number;
  color: string;
  symbolColor: string;
} {
  const colors = CHROME_COLORS[dark ? 'dark' : 'light'];
  return { height: TITLE_BAR_HEIGHT, color: colors.chrome, symbolColor: colors.symbol };
}
