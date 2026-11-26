import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHROME_COLORS, isDarkUi, titleBarOverlay } from './windowChrome';
import { mainWindowOptions } from './windowOptions';

/** tokens.css의 한 블록(:root 또는 라이트)에서 토큰 값을 읽는다 */
function tokens(block: 'dark' | 'light'): Record<string, string> {
  const css = readFileSync(join(__dirname, '../../../../client/ui/src/theme/tokens.css'), 'utf8');
  const start =
    block === 'dark' ? css.indexOf(':root {') : css.indexOf(":root[data-theme='light'] {");
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().toLowerCase()]),
  );
}

const expand = (hex: string) =>
  hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;

describe('창 크롬(DESIGN §4.2)', () => {
  it('화면 모드가 system이거나 없으면 OS를 따르고, 라이트·다크는 그대로', () => {
    expect(isDarkUi('system', true)).toBe(true);
    expect(isDarkUi('system', false)).toBe(false);
    expect(isDarkUi(undefined, true)).toBe(true);
    expect(isDarkUi('light', true)).toBe(false);
    expect(isDarkUi('dark', false)).toBe(true);
  });

  it.each(['dark', 'light'] as const)('%s 색은 tokens.css의 값과 같다', (mode) => {
    const values = tokens(mode);
    const colors = CHROME_COLORS[mode];
    expect(colors.base.toLowerCase()).toBe(expand(values['--surface-base']!));
    expect(colors.chrome.toLowerCase()).toBe(expand(values['--surface-chrome']!));
    expect(colors.symbol.toLowerCase()).toBe(expand(values['--text-secondary']!));
  });

  it('제목 표시줄 버튼은 높이 46(헤더 48 − 구분선 2), 헤더 색', () => {
    expect(titleBarOverlay(false)).toEqual({
      height: 46,
      color: CHROME_COLORS.light.chrome,
      symbolColor: CHROME_COLORS.light.symbol,
    });
  });

  it('창은 기본 제목 표시줄을 숨기고 버튼을 헤더에 겹치며, 첫 배경은 화면 모드의 바탕색', () => {
    const light = mainWindowOptions('p', { packaged: true, dark: false, platform: 'windows' });
    expect(light).toMatchObject({
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarOverlay(false),
      backgroundColor: CHROME_COLORS.light.base,
    });
    expect(
      mainWindowOptions('p', { packaged: true, dark: true, platform: 'windows' }).backgroundColor,
    ).toBe(CHROME_COLORS.dark.base);
  });
});
