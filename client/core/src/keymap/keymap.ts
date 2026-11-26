// 단축키 데이터와 매칭 (PRD F5.2, DESIGN §8.1이 원천). 순수 모듈: DOM/Electron 의존 없음.

export type KeymapPlatform = 'windows' | 'mac';

export type AppAction =
  | 'quickConnect'
  | 'commandPalette'
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'copy'
  | 'paste'
  | 'scrollPageUp'
  | 'scrollPageDown'
  | 'scrollLineUp'
  | 'scrollLineDown'
  | 'clearScrollback'
  | 'toggleSidebar'
  | 'focusSftp'
  | 'findInTerminal'
  | 'reconnect'
  | 'toggleToolPanel'
  | 'historySearch'
  | 'cycleRegionForward'
  | 'cycleRegionBackward'
  | `goToTab${TabNumber}`
  | `focusPane${PaneDirection}`
  | `resizePane${PaneDirection}`
  | 'splitSameServer';

export type TabNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type PaneDirection = 'Left' | 'Right' | 'Up' | 'Down';
export const PANE_DIRECTIONS: readonly PaneDirection[] = ['Left', 'Right', 'Up', 'Down'];

export interface KeyChord {
  /** KeyboardEvent.code (예: 'KeyC', 'Insert', 'PageUp', 'ArrowUp', 'F6') */
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface KeyBinding {
  action: AppAction;
  chords: Record<KeymapPlatform, KeyChord[]>;
  /** 터미널 포커스일 때만 가로챈다(복사·붙여넣기·스크롤 등). 입력칸에서는 브라우저 기본 동작으로 둔다 */
  terminalScoped?: boolean;
  /** 칸이 2개 이상일 때만 가로챈다. 아니면 터미널로 보낸다(결정 UX2) */
  paneScoped?: boolean;
}

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

const CS = { ctrl: true, shift: true } as const;
const CMD = { meta: true } as const;
const CMD_SHIFT = { meta: true, shift: true } as const;

const TAB_NUMBERS: readonly TabNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 활성 칸의 N번째 탭(9 = 마지막). Shift 없는 Ctrl+숫자(^@, ^^ 등)는 터미널로 간다. */
const TAB_BINDINGS: KeyBinding[] = TAB_NUMBERS.map((n) => ({
  action: `goToTab${n}`,
  chords: { windows: [{ code: `Digit${n}`, ...CS }], mac: [{ code: `Digit${n}`, ...CMD }] },
}));

/** 칸 포커스 이동(Ctrl+Alt+방향키)·크기 조절(+Shift). 칸이 하나면 터미널로(결정 UX2). */
const PANE_BINDINGS: KeyBinding[] = [
  ...PANE_DIRECTIONS.map((d): KeyBinding => ({
    action: `focusPane${d}`,
    paneScoped: true,
    chords: {
      windows: [{ code: `Arrow${d}`, ctrl: true, alt: true }],
      mac: [{ code: `Arrow${d}`, meta: true, alt: true }],
    },
  })),
  ...PANE_DIRECTIONS.map((d): KeyBinding => ({
    action: `resizePane${d}`,
    paneScoped: true,
    chords: {
      windows: [{ code: `Arrow${d}`, ctrl: true, alt: true, shift: true }],
      mac: [{ code: `Arrow${d}`, meta: true, alt: true, shift: true }],
    },
  })),
];

export const KEYMAP: readonly KeyBinding[] = [
  {
    action: 'quickConnect',
    chords: { windows: [{ code: 'KeyK', ...CS }], mac: [{ code: 'KeyK', ...CMD_SHIFT }] },
  },
  {
    action: 'commandPalette',
    chords: { windows: [{ code: 'KeyP', ...CS }], mac: [{ code: 'KeyP', ...CMD_SHIFT }] },
  },
  {
    action: 'newTab',
    chords: { windows: [{ code: 'KeyT', ...CS }], mac: [{ code: 'KeyT', ...CMD }] },
  },
  {
    action: 'closeTab',
    chords: { windows: [{ code: 'KeyW', ...CS }], mac: [{ code: 'KeyW', ...CMD }] },
  },
  {
    action: 'nextTab',
    chords: {
      windows: [{ code: 'PageDown', ...CS }],
      mac: [{ code: 'BracketRight', ...CMD_SHIFT }],
    },
  },
  {
    action: 'prevTab',
    chords: {
      windows: [{ code: 'PageUp', ...CS }],
      mac: [{ code: 'BracketLeft', ...CMD_SHIFT }],
    },
  },
  {
    action: 'copy',
    terminalScoped: true,
    chords: {
      windows: [
        { code: 'KeyC', ...CS },
        { code: 'Insert', ctrl: true },
      ],
      mac: [{ code: 'KeyC', ...CMD }],
    },
  },
  {
    action: 'paste',
    terminalScoped: true,
    chords: {
      windows: [
        { code: 'KeyV', ...CS },
        { code: 'Insert', shift: true },
      ],
      mac: [{ code: 'KeyV', ...CMD }],
    },
  },
  {
    action: 'scrollPageUp',
    terminalScoped: true,
    chords: { windows: [{ code: 'PageUp', shift: true }], mac: [{ code: 'PageUp', shift: true }] },
  },
  {
    action: 'scrollPageDown',
    terminalScoped: true,
    chords: {
      windows: [{ code: 'PageDown', shift: true }],
      mac: [{ code: 'PageDown', shift: true }],
    },
  },
  {
    action: 'scrollLineUp',
    terminalScoped: true,
    chords: { windows: [{ code: 'ArrowUp', ...CS }], mac: [{ code: 'ArrowUp', ...CMD }] },
  },
  {
    action: 'scrollLineDown',
    terminalScoped: true,
    chords: { windows: [{ code: 'ArrowDown', ...CS }], mac: [{ code: 'ArrowDown', ...CMD }] },
  },
  {
    action: 'clearScrollback',
    terminalScoped: true,
    chords: { windows: [{ code: 'Delete', ...CS }], mac: [{ code: 'KeyK', ...CMD }] },
  },
  {
    action: 'toggleSidebar',
    chords: { windows: [{ code: 'KeyB', ...CS }], mac: [{ code: 'KeyB', ...CMD }] },
  },
  {
    action: 'focusSftp',
    chords: { windows: [{ code: 'KeyE', ...CS }], mac: [{ code: 'KeyE', ...CMD_SHIFT }] },
  },
  {
    action: 'findInTerminal',
    chords: { windows: [{ code: 'KeyF', ...CS }], mac: [{ code: 'KeyF', ...CMD }] },
  },
  {
    action: 'reconnect',
    chords: { windows: [{ code: 'KeyR', ...CS }], mac: [{ code: 'KeyR', ...CMD_SHIFT }] },
  },
  {
    action: 'toggleToolPanel',
    chords: { windows: [{ code: 'KeyL', ...CS }], mac: [{ code: 'KeyL', ...CMD_SHIFT }] },
  },
  {
    action: 'historySearch',
    chords: { windows: [{ code: 'KeyH', ...CS }], mac: [{ code: 'KeyH', ...CMD_SHIFT }] },
  },
  {
    action: 'cycleRegionForward',
    chords: { windows: [{ code: 'F6' }], mac: [{ code: 'F6' }] },
  },
  {
    action: 'cycleRegionBackward',
    chords: { windows: [{ code: 'F6', shift: true }], mac: [{ code: 'F6', shift: true }] },
  },
  ...TAB_BINDINGS,
  ...PANE_BINDINGS,
  {
    action: 'splitSameServer',
    chords: { windows: [{ code: 'KeyD', ...CS }], mac: [{ code: 'KeyD', ...CMD }] },
  },
];

/** 터미널 포커스일 때만 가로채는 액션인가(TerminalRegistry가 처리한다) */
export function isTerminalScoped(action: AppAction): boolean {
  return KEYMAP.some((b) => b.action === action && b.terminalScoped === true);
}

/** 칸이 2개 이상일 때만 의미 있는 액션인가 */
export function isPaneScoped(action: AppAction): boolean {
  return KEYMAP.some((b) => b.action === action && b.paneScoped === true);
}

function chordMatches(chord: KeyChord, event: KeyEventLike): boolean {
  return (
    chord.code === event.code &&
    Boolean(chord.ctrl) === event.ctrlKey &&
    Boolean(chord.shift) === event.shiftKey &&
    Boolean(chord.alt) === event.altKey &&
    Boolean(chord.meta) === event.metaKey
  );
}

/** IME 조합 중이면 항상 null. 수정키는 정확히 일치해야 한다. */
export function matchShortcut(event: KeyEventLike, platform: KeymapPlatform): AppAction | null {
  if (event.isComposing) return null;
  for (const binding of KEYMAP) {
    if (binding.chords[platform].some((chord) => chordMatches(chord, event))) {
      return binding.action;
    }
  }
  return null;
}

const SPECIAL_KEY_NAMES: Readonly<Record<string, string>> = {
  BracketLeft: '[',
  BracketRight: ']',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

function acceleratorKey(code: string): string {
  const named = SPECIAL_KEY_NAMES[code];
  if (named !== undefined) return named;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  return code;
}

/** 동작의 첫 단축키 표기(명령 팔레트·툴팁, F5.1b). 단축키가 없으면 undefined */
export function shortcutOf(action: AppAction, platform: KeymapPlatform): string | undefined {
  const chord = KEYMAP.find((binding) => binding.action === action)?.chords[platform][0];
  return chord ? toAccelerator(chord, platform) : undefined;
}

/** Electron accelerator 문자열(예: 'Ctrl+Shift+T', 'Cmd+Shift+['). */
export function toAccelerator(chord: KeyChord, platform: KeymapPlatform): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.meta) parts.push(platform === 'mac' ? 'Cmd' : 'Super');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(acceleratorKey(chord.code));
  return parts.join('+');
}
