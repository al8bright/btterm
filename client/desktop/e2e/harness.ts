import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { KEYMAP, type AppAction, type KeymapPlatform } from '@btterm/core';

// E2E 빌드(pnpm build:e2e)를 띄운다. 별도 userData로 실제 사용자 데이터와 분리한다(AGENTS §6).
const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js');

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  /** 앱만 끄고 데이터는 남긴다(재시작 시나리오). */
  quit(): Promise<void>;
  /** 앱을 끄고 데이터 폴더를 지운다. */
  close(): Promise<void>;
}

export async function launchApp(
  existingUserData?: string,
  extraEnv: Record<string, string> = {},
): Promise<LaunchedApp> {
  const userData = existingUserData ?? (await mkdtemp(join(tmpdir(), 'btterm-e2e-')));
  const app = await electron.launch({
    args: [mainEntry],
    env: { ...process.env, ...extraEnv, BTTERM_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  let running = true;
  const quit = async () => {
    if (!running) return;
    running = false;
    await app.close();
  };
  return {
    app,
    page,
    userData,
    quit,
    close: async () => {
      await quit();
      await rm(userData, { recursive: true, force: true });
    },
  };
}

/** 데이터 폴더의 모든 파일 내용을 이어 붙인다(평문 비밀 검사용, AC26). 앱을 끈 뒤 호출한다. */
export async function readAllFiles(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const texts = await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map((e) => readFile(join(e.parentPath, e.name), 'latin1').catch(() => '')),
  );
  return texts.join('\n');
}

type TestHook = { __bttermTest?: { bufferText(sessionId?: string): string } };

/** 터미널 버퍼 텍스트. sessionId가 없으면 마지막으로 만든 터미널. */
export function bufferText(page: Page, sessionId?: string): Promise<string> {
  return page.evaluate(
    (id) => (globalThis as unknown as TestHook).__bttermTest?.bufferText(id) ?? '',
    sessionId,
  );
}

export async function typeInTerminal(page: Page, text: string): Promise<void> {
  await page.locator('.terminal-host[data-active=true] .xterm-helper-textarea').focus();
  await page.keyboard.type(text);
}

/**
 * main의 클립보드를 메모리 대체물로 바꾼다. OS 클립보드를 다른 프로세스가 잡고 있으면
 * 읽기·쓰기가 조용히 실패해 테스트가 흔들리므로, 앱 경로(main → renderer → 터미널)만 검증한다.
 */
export async function useMemoryClipboard(app: LaunchedApp['app']): Promise<void> {
  await app.evaluate(({ clipboard }) => {
    let value = '';
    clipboard.readText = (() => value) as unknown as typeof clipboard.readText;
    clipboard.writeText = ((text: string) => {
      value = text;
    }) as typeof clipboard.writeText;
  });
}

/** 앱이 쓰는 키맵 OS(preload가 넘긴 플래그, D12) */
export function appPlatform(page: Page): Promise<KeymapPlatform> {
  return page.evaluate(
    () => (globalThis as unknown as { btterm: { platform: KeymapPlatform } }).btterm.platform,
  );
}

/** 동작의 첫 단축키를 OS 키맵(DESIGN §8.1)대로 누른다. Windows Ctrl+Shift+E = macOS Cmd+Shift+E */
export async function pressShortcut(page: Page, action: AppAction): Promise<void> {
  const platform = await appPlatform(page);
  const chord = KEYMAP.find((binding) => binding.action === action)?.chords[platform][0];
  if (!chord) throw new Error(`단축키 없음: ${action}`);
  const keys = [
    chord.ctrl && 'Control',
    chord.meta && 'Meta',
    chord.alt && 'Alt',
    chord.shift && 'Shift',
    chord.code,
  ].filter(Boolean);
  await page.keyboard.press(keys.join('+'));
}
