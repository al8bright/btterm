import { describe, expect, it } from 'vitest';
import {
  KEYMAP,
  isTerminalScoped,
  matchShortcut,
  shortcutOf,
  toAccelerator,
  type KeyChord,
  type KeyEventLike,
  type KeymapPlatform,
} from './keymap';

const PLATFORMS: KeymapPlatform[] = ['windows', 'mac'];

function event(code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  };
}

function chordKey(c: KeyChord): string {
  return [c.ctrl, c.shift, c.alt, c.meta, c.code].map(String).join('|');
}

describe('KEYMAP 불변 조건', () => {
  it('SEC-8 Windows 앱 단축키는 Ctrl+(문자)·Alt+(문자)·Ctrl+Tab을 쓰지 않는다', () => {
    const letter = /^Key[A-Z]$/;
    for (const binding of KEYMAP) {
      for (const c of binding.chords.windows) {
        const label = `${binding.action}:${chordKey(c)}`;
        expect(Boolean(c.ctrl && !c.shift && letter.test(c.code)), label).toBe(false);
        expect(Boolean(c.alt && letter.test(c.code)), label).toBe(false);
        expect(Boolean(c.ctrl && c.code === 'Tab'), label).toBe(false);
      }
    }
  });

  it('mac에서 Cmd+R은 어떤 액션에도 쓰지 않는다', () => {
    for (const binding of KEYMAP) {
      for (const c of binding.chords.mac) {
        expect(Boolean(c.meta && !c.shift && c.code === 'KeyR')).toBe(false);
      }
    }
  });

  it('같은 플랫폼 안에서 chord 중복이 없다', () => {
    for (const platform of PLATFORMS) {
      const keys = KEYMAP.flatMap((b) => b.chords[platform].map(chordKey));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('모든 액션이 한 번씩만 등장하고 두 플랫폼 모두 chord가 있다', () => {
    const actions = KEYMAP.map((b) => b.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toHaveLength(39);
    for (const b of KEYMAP) {
      expect(b.chords.windows.length).toBeGreaterThan(0);
      expect(b.chords.mac.length).toBeGreaterThan(0);
    }
  });
});

describe('shortcutOf (명령 팔레트 표시, F5.1b)', () => {
  it('동작의 첫 단축키를 플랫폼 표기로 돌려주고, 없으면 undefined', () => {
    expect(shortcutOf('quickConnect', 'windows')).toBe('Ctrl+Shift+K');
    expect(shortcutOf('quickConnect', 'mac')).toBe('Cmd+Shift+K');
    expect(shortcutOf('nope' as never, 'windows')).toBeUndefined();
  });
});

describe('matchShortcut', () => {
  it('Windows Ctrl+Shift+K는 quickConnect', () => {
    expect(matchShortcut(event('KeyK', { ctrlKey: true, shiftKey: true }), 'windows')).toBe(
      'quickConnect',
    );
  });

  it('Windows 복사/붙여넣기 대체 키(Ctrl+Insert, Shift+Insert)를 인식한다', () => {
    expect(matchShortcut(event('Insert', { ctrlKey: true }), 'windows')).toBe('copy');
    expect(matchShortcut(event('Insert', { shiftKey: true }), 'windows')).toBe('paste');
  });

  it('Windows 스크롤 키: Shift+PageUp은 한 페이지, Ctrl+Shift+ArrowUp은 한 줄', () => {
    expect(matchShortcut(event('PageUp', { shiftKey: true }), 'windows')).toBe('scrollPageUp');
    expect(matchShortcut(event('ArrowDown', { ctrlKey: true, shiftKey: true }), 'windows')).toBe(
      'scrollLineDown',
    );
  });

  it('Windows 탭 이동은 Ctrl+Shift+PageUp/PageDown', () => {
    expect(matchShortcut(event('PageUp', { ctrlKey: true, shiftKey: true }), 'windows')).toBe(
      'prevTab',
    );
    expect(matchShortcut(event('PageDown', { ctrlKey: true, shiftKey: true }), 'windows')).toBe(
      'nextTab',
    );
  });

  it('F6 / Shift+F6은 영역 순환(두 플랫폼 공통)', () => {
    for (const p of PLATFORMS) {
      expect(matchShortcut(event('F6'), p)).toBe('cycleRegionForward');
      expect(matchShortcut(event('F6', { shiftKey: true }), p)).toBe('cycleRegionBackward');
    }
  });

  it('mac Cmd+T, Cmd+Shift+BracketLeft, Cmd+K, Cmd+Shift+R을 인식한다', () => {
    expect(matchShortcut(event('KeyT', { metaKey: true }), 'mac')).toBe('newTab');
    expect(matchShortcut(event('BracketLeft', { metaKey: true, shiftKey: true }), 'mac')).toBe(
      'prevTab',
    );
    expect(matchShortcut(event('KeyK', { metaKey: true }), 'mac')).toBe('clearScrollback');
    expect(matchShortcut(event('KeyR', { metaKey: true, shiftKey: true }), 'mac')).toBe(
      'reconnect',
    );
    expect(matchShortcut(event('KeyR', { metaKey: true }), 'mac')).toBeNull();
  });

  it('Windows에서 Ctrl+W, Ctrl+C, Alt+F 같은 터미널 키는 가로채지 않는다', () => {
    expect(matchShortcut(event('KeyW', { ctrlKey: true }), 'windows')).toBeNull();
    expect(matchShortcut(event('KeyC', { ctrlKey: true }), 'windows')).toBeNull();
    expect(matchShortcut(event('KeyF', { altKey: true }), 'windows')).toBeNull();
    expect(matchShortcut(event('Tab', { ctrlKey: true }), 'windows')).toBeNull();
  });

  it('IME 조합 중이면 항상 null', () => {
    expect(
      matchShortcut(event('KeyK', { ctrlKey: true, shiftKey: true, isComposing: true }), 'windows'),
    ).toBeNull();
    expect(matchShortcut(event('F6', { isComposing: true }), 'mac')).toBeNull();
  });

  it('여분 수정키가 있으면 불일치', () => {
    expect(
      matchShortcut(event('KeyK', { ctrlKey: true, shiftKey: true, altKey: true }), 'windows'),
    ).toBeNull();
    expect(matchShortcut(event('F6', { ctrlKey: true }), 'windows')).toBeNull();
    expect(matchShortcut(event('PageUp', { shiftKey: true, metaKey: true }), 'windows')).toBeNull();
  });

  it('code 기반이라 대소문자(Shift 상태)와 무관하게 같은 키로 본다', () => {
    const e = event('KeyT', { ctrlKey: true, shiftKey: true });
    expect(matchShortcut(e, 'windows')).toBe('newTab');
  });

  it('플랫폼이 다르면 매칭하지 않는다', () => {
    expect(matchShortcut(event('KeyT', { metaKey: true }), 'windows')).toBeNull();
  });
});

describe('칸·탭 조작 단축키 (F3.10b, 결정 UX2)', () => {
  it('Ctrl+Shift+1~9는 N번째 탭, Ctrl+Shift+D는 같은 서버로 오른쪽 분할', () => {
    expect(matchShortcut(event('Digit3', { ctrlKey: true, shiftKey: true }), 'windows')).toBe(
      'goToTab3',
    );
    expect(matchShortcut(event('Digit9', { metaKey: true }), 'mac')).toBe('goToTab9');
    expect(matchShortcut(event('KeyD', { ctrlKey: true, shiftKey: true }), 'windows')).toBe(
      'splitSameServer',
    );
    // Shift 없는 Ctrl+6(^^)·Ctrl+2(^@)는 터미널로
    expect(matchShortcut(event('Digit6', { ctrlKey: true }), 'windows')).toBeNull();
  });

  it('Ctrl+Alt+방향키는 칸 포커스, Ctrl+Alt+Shift+방향키는 칸 크기이며 칸이 2개 이상일 때만 쓴다', () => {
    expect(matchShortcut(event('ArrowLeft', { ctrlKey: true, altKey: true }), 'windows')).toBe(
      'focusPaneLeft',
    );
    expect(
      matchShortcut(event('ArrowDown', { ctrlKey: true, altKey: true, shiftKey: true }), 'windows'),
    ).toBe('resizePaneDown');
    expect(matchShortcut(event('ArrowUp', { metaKey: true, altKey: true }), 'mac')).toBe(
      'focusPaneUp',
    );
    const paneScoped = KEYMAP.filter((b) => b.paneScoped).map((b) => b.action);
    expect(paneScoped).toEqual([
      'focusPaneLeft',
      'focusPaneRight',
      'focusPaneUp',
      'focusPaneDown',
      'resizePaneLeft',
      'resizePaneRight',
      'resizePaneUp',
      'resizePaneDown',
    ]);
  });
});

describe('toAccelerator', () => {
  it('Windows는 Ctrl+Shift+T 형식', () => {
    expect(toAccelerator({ code: 'KeyT', ctrl: true, shift: true }, 'windows')).toBe(
      'Ctrl+Shift+T',
    );
  });

  it('mac은 Cmd+Shift+[ 형식', () => {
    expect(toAccelerator({ code: 'BracketLeft', meta: true, shift: true }, 'mac')).toBe(
      'Cmd+Shift+[',
    );
  });

  it('특수 키 이름을 Electron 표기로 바꾼다', () => {
    expect(toAccelerator({ code: 'PageUp', ctrl: true, shift: true }, 'windows')).toBe(
      'Ctrl+Shift+PageUp',
    );
    expect(toAccelerator({ code: 'ArrowUp', meta: true }, 'mac')).toBe('Cmd+Up');
    expect(toAccelerator({ code: 'F6', shift: true }, 'windows')).toBe('Shift+F6');
    expect(toAccelerator({ code: 'Delete', ctrl: true, shift: true }, 'windows')).toBe(
      'Ctrl+Shift+Delete',
    );
    expect(toAccelerator({ code: 'Insert', ctrl: true }, 'windows')).toBe('Ctrl+Insert');
  });

  it('모든 바인딩의 첫 chord가 비어 있지 않은 accelerator가 된다', () => {
    for (const b of KEYMAP) {
      for (const p of PLATFORMS) {
        expect(toAccelerator(b.chords[p][0]!, p)).toMatch(/\S/);
      }
    }
  });
});

describe('isTerminalScoped', () => {
  it('복사·붙여넣기·스크롤·스크롤백 지우기는 터미널 포커스에서만 가로챈다', () => {
    for (const action of [
      'copy',
      'paste',
      'clearScrollback',
      'scrollPageUp',
      'scrollLineDown',
    ] as const) {
      expect(isTerminalScoped(action)).toBe(true);
    }
    expect(isTerminalScoped('newTab')).toBe(false);
  });
});
