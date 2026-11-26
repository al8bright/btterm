import { z } from 'zod';
import { SavedNodeSchema } from './lastSession';
import { SnippetListSchema } from './snippets';
import { WindowStateSchema } from './windowState';

/** 내장 터미널 테마 9종(F3.16c, 결정 DF9). 어두운 테마 먼저, 밝은 테마는 끝에 */
export const TERMINAL_THEME_IDS = [
  'btterm-dark',
  'one-dark',
  'dracula',
  'monokai',
  'nord',
  'gruvbox-dark',
  'solarized-dark',
  'solarized-light',
  'github-light',
] as const;
export type TerminalThemeId = (typeof TERMINAL_THEME_IDS)[number];

const TerminalSettingsSchema = z.object({
  themeId: z.enum(TERMINAL_THEME_IDS),
  fontFamily: z.string().min(1).max(200),
  fontSize: z.number().int().min(8).max(32),
  cursor: z.enum(['block', 'underline', 'bar']),
});

const ToolPanelSchema = z.enum(['design', 'history', 'snippets']);

/** 화면 모드(F5.3). system = OS 설정을 따른다 */
export const UI_THEMES = ['system', 'light', 'dark'] as const;
export type UiTheme = (typeof UI_THEMES)[number];

const UiSettingsSchema = z.object({
  sidebarOpen: z.boolean(),
  toolPanel: ToolPanelSchema.nullable(),
  lastToolPanel: ToolPanelSchema,
  /** 없으면 system. 선택 필드라 설정 파일 버전을 올리지 않는다(결정 UX7) */
  theme: z.enum(UI_THEMES).optional(),
});

export const APP_SETTINGS_VERSION = 1;

/**
 * 앱 설정 파일(F6.7). 패널 상태·터미널 기본값. localStorage는 쓰지 않는다(DESIGN §11).
 * 모르는 키는 버린다: 제거한 계정 자동 잠금(accountLock)이 남은 예전 파일도 그대로 읽힌다.
 */
export const AppSettingsSchema = z.object({
  schemaVersion: z.literal(APP_SETTINGS_VERSION),
  terminal: TerminalSettingsSchema,
  ui: UiSettingsSchema,
  /** 창 위치·크기(F6.7). main만 쓰고 renderer 패치로는 바꿀 수 없다(결정 DF2). 선택 필드라 버전 유지 */
  // 창 상태만 잘못돼 있으면 그 값만 버리고 나머지 설정은 지킨다(보안 리뷰 M1)
  window: WindowStateSchema.optional().catch(undefined),
  /** 스니펫(F3.14 1단계, DF7). 선택 필드라 버전 유지 */
  snippets: SnippetListSchema.optional(),
  /** 지난번 칸 배치와 탭(F6.9, DF8). 잘못되면 이 값만 버린다 */
  lastSession: SavedNodeSchema.optional().catch(undefined),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type TerminalSettings = z.infer<typeof TerminalSettingsSchema>;

export const AppSettingsPatchSchema = z.object({
  terminal: TerminalSettingsSchema.partial().optional(),
  ui: UiSettingsSchema.partial().optional(),
  /** 주면 목록을 통째로 바꾼다 */
  snippets: SnippetListSchema.optional(),
  /** null이면 지운다 */
  lastSession: SavedNodeSchema.nullable().optional(),
});
export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>;

export function defaultAppSettings(): AppSettings {
  return {
    schemaVersion: APP_SETTINGS_VERSION,
    terminal: {
      themeId: 'btterm-dark',
      fontFamily: '"D2Coding", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cursor: 'block',
    },
    ui: { sidebarOpen: true, toolPanel: null, lastToolPanel: 'design' },
  };
}

export function applySettingsPatch(settings: AppSettings, patch: AppSettingsPatch): AppSettings {
  const next: AppSettings = {
    ...settings,
    terminal: { ...settings.terminal, ...stripUndefined(patch.terminal) },
    ui: { ...settings.ui, ...stripUndefined(patch.ui) },
    ...(patch.snippets ? { snippets: patch.snippets } : {}),
    ...(patch.lastSession ? { lastSession: patch.lastSession } : {}),
  };
  // null = 지난번 탭 기록을 지운다(F6.9)
  if (patch.lastSession === null) delete next.lastSession;
  return next;
}

function stripUndefined<T extends object>(
  value: T | undefined,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
