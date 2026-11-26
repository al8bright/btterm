import { describe, expect, it } from 'vitest';
import { TERMINAL_THEME_IDS } from '@btterm/core';
import { t, type MessageKey } from '../i18n';
import { TERMINAL_THEMES } from './themes';

const FIELDS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

describe('터미널 테마 (F3.16c, 결정 DF9)', () => {
  it('많이 쓰는 9종', () => {
    expect([...TERMINAL_THEME_IDS]).toEqual([
      'btterm-dark',
      'one-dark',
      'dracula',
      'monokai',
      'nord',
      'gruvbox-dark',
      'solarized-dark',
      'solarized-light',
      'github-light',
    ]);
  });

  it.each([...TERMINAL_THEME_IDS])(
    '%s: 배경·글자·커서·선택·ANSI 16색이 모두 #RRGGBB(AA)이고 이름이 있다',
    (id) => {
      const theme = TERMINAL_THEMES[id] as Record<string, string | undefined>;
      for (const field of FIELDS)
        expect(theme[field], field).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
      expect(t(`theme.${id}` as MessageKey)).not.toBe(`theme.${id}`);
    },
  );
});
