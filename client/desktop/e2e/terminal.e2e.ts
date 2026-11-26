import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import electronPath from 'electron';
import {
  bufferText,
  launchApp,
  readAllFiles,
  typeInTerminal,
  useMemoryClipboard,
  type LaunchedApp,
  pressShortcut,
} from './harness';

let launched: LaunchedApp;
let page: Page;

test.beforeEach(async () => {
  launched = await launchApp();
  page = launched.page;
});

test.afterEach(async () => {
  await launched.close();
});

/** 컨테이너 안에서 btterm 사용자로 실행한다(root는 다른 사용자의 프로세스를 못 본다). */
function container(script: string): string {
  return execFileSync(
    'docker',
    ['exec', '-u', 'btterm', '-e', 'HOME=/config', 'btterm-test-target-1', 'sh', '-c', script],
    {
      encoding: 'utf8',
    },
  );
}

/** 서버 쪽 btterm 사용자의 SSH 세션 수 */
function remoteSessions(): number {
  return Number(container("ps -o args | grep -c '[b]tterm@pts' || true").trim());
}

async function activeSessionId(): Promise<string> {
  const id = await page.locator('.terminal-host[data-active=true]').getAttribute('id');
  return id!.replace(/^panel-/, '');
}

async function activeBuffer(): Promise<string> {
  return bufferText(page, await activeSessionId());
}

async function openTab(hostKey: '이번만 허용' | '신뢰하고 저장' | null = '이번만 허용') {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  if (hostKey) await page.getByRole('button', { name: hostKey }).click();
  await expect.poll(activeBuffer, { timeout: 20_000 }).toMatch(/[$#] *$/m);
}

async function run(command: string) {
  await typeInTerminal(page, command);
  await page.keyboard.press('Enter');
}

test('AC8 탭 두 개는 서로 다른 셸이고 출력이 섞이지 않는다', async () => {
  await openTab('신뢰하고 저장');
  const first = await activeSessionId();
  await run('export TABMARK=first-tab; echo mark-$TABMARK');
  await openTab(null);
  const second = await activeSessionId();
  expect(second).not.toBe(first);
  await run('echo mark-${TABMARK:-unset}');
  await expect.poll(() => bufferText(page, second)).toContain('mark-unset');
  expect(await bufferText(page, first)).not.toContain('mark-unset');
  expect(await bufferText(page, second)).not.toContain('mark-first-tab');

  await page
    .getByRole('tab', { name: /btterm@127\.0\.0\.1/ })
    .first()
    .click();
  expect(await activeSessionId()).toBe(first);
});

test('AC13 탭을 닫으면 서버 쪽 세션도 끝난다', async () => {
  const before = remoteSessions();
  await openTab();
  await expect.poll(remoteSessions).toBe(before + 1);
  await pressShortcut(page, 'closeTab');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect.poll(remoteSessions, { timeout: 10_000 }).toBe(before);
});

test('AC14 앱을 끄면 열린 세션이 모두 정리된다', async () => {
  const before = remoteSessions();
  await openTab('신뢰하고 저장');
  await openTab(null);
  await expect.poll(remoteSessions).toBe(before + 2);
  const started = Date.now();
  await launched.quit();
  expect(Date.now() - started).toBeLessThan(5000);
  await expect.poll(remoteSessions, { timeout: 10_000 }).toBe(before);
});

test('AC20 두 번째 실행은 새 창 없이 끝나고 기존 창이 남는다', async () => {
  const second = spawn(String(electronPath), [join(__dirname, '..', 'out', 'main', 'index.js')], {
    env: { ...process.env, BTTERM_USER_DATA: launched.userData },
    stdio: 'ignore',
  });
  const code = await new Promise<number | null>((resolve) => second.on('exit', resolve));
  expect(code).toBe(0);
  expect(launched.app.windows()).toHaveLength(1);
});

test('F3.8 F3.9 붙여넣기: 한 줄은 바로, 여러 줄은 확인 후', async () => {
  await useMemoryClipboard(launched.app);
  await openTab();
  await launched.app.evaluate(({ clipboard }) => clipboard.writeText('echo pasted-$((3*3))'));
  await page.locator('.terminal-host[data-active=true] .xterm-helper-textarea').focus();
  await pressShortcut(page, 'paste');
  await page.keyboard.press('Enter');
  await expect.poll(activeBuffer).toContain('pasted-9');

  await launched.app.evaluate(({ clipboard }) => clipboard.writeText('echo one-$((1))\necho two'));
  await page.locator('.terminal-host[data-active=true] .xterm-helper-textarea').focus();
  await pressShortcut(page, 'paste');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('2줄');
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await activeBuffer()).not.toContain('one-1');
});

test('터미널 찾기: Ctrl+Shift+F로 열고 없으면 알린다', async () => {
  await openTab();
  await run('echo find-me-here');
  await page.locator('.terminal-host[data-active=true] .xterm-helper-textarea').focus();
  await pressShortcut(page, 'findInTerminal');
  const find = page.getByRole('textbox', { name: '터미널에서 찾기' });
  await find.fill('no-such-text-zz');
  await find.press('Enter');
  await expect(page.getByText('일치 없음')).toBeVisible();
  await find.fill('find-me');
  await find.press('Enter');
  await expect(page.getByText('일치 없음')).toHaveCount(0);
  await find.press('Escape');
  await expect(find).toHaveCount(0);
});

test('AC30b 원격 ~/.bash_history를 검색해 프롬프트에 입력만 하고, 비밀은 가리며 기록을 저장하지 않는다', async () => {
  container(
    "printf 'ls -al\\nsudo nginx -t\\nmysql -psecret\\necho history-e2e-$((6*7))\\n' > /config/.bash_history",
  );
  await openTab();
  await page.locator('.terminal-host[data-active=true] .xterm-helper-textarea').focus();
  await pressShortcut(page, 'historySearch');
  const search = page.getByRole('searchbox', { name: '명령 기록 검색' });
  await expect(page.getByRole('option')).toHaveCount(4);
  await expect(page.getByRole('listbox')).toContainText('mysql -p[masked]');
  await expect(page.getByRole('listbox')).not.toContainText('-psecret');

  await search.fill('nginx');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toHaveText('sudo nginx -t');

  await search.fill('history-e2e');
  await search.press('Enter');
  // 입력만 하고 실행하지 않는다: 프롬프트 줄에 명령이 있고 결과(42)는 아직 없다.
  await expect.poll(activeBuffer).toMatch(/[$#] echo history-e2e-\$\(\(6\*7\)\)\s*$/m);
  expect(await activeBuffer()).not.toContain('history-e2e-42');
  await page.locator('.terminal-host[data-active=true] .xterm-helper-textarea').focus();
  await page.keyboard.press('Enter');
  await expect.poll(activeBuffer).toContain('history-e2e-42');

  await launched.quit();
  const stored = await readAllFiles(launched.userData);
  expect(stored).not.toContain('nginx -t');
  expect(stored).not.toContain('history-e2e');
});

async function terminalBackground(sessionId: string): Promise<string> {
  return page.evaluate(
    (id) =>
      getComputedStyle(document.querySelector(`#panel-${id} .xterm-scrollable-element`)!)
        .backgroundColor,
    sessionId,
  );
}

test('AC30 디자인 탭: "이 탭만"은 현재 탭만, "전체 기본값"은 모든 탭과 재시작 후에도', async () => {
  const ONE_DARK = 'rgb(40, 44, 52)';
  const BTTERM_DARK = 'rgb(11, 13, 16)';
  await openTab('신뢰하고 저장');
  const first = await activeSessionId();
  await openTab(null);
  const second = await activeSessionId();

  await pressShortcut(page, 'toggleToolPanel');
  const panel = page.getByRole('complementary', { name: '터미널 도구 패널' });
  await panel.getByRole('radio', { name: '이 탭만' }).check();
  await panel.getByRole('radio', { name: /One Dark/ }).click();
  await expect.poll(() => terminalBackground(second)).toBe(ONE_DARK);
  expect(await terminalBackground(first)).toBe(BTTERM_DARK);

  await panel.getByRole('radio', { name: '전체 기본값' }).check();
  await panel.getByRole('radio', { name: /GitHub Light/ }).click();
  await expect.poll(() => terminalBackground(first)).toBe('rgb(255, 255, 255)');
  expect(await terminalBackground(second)).toBe(ONE_DARK); // 탭별 선택이 우선

  const userData = launched.userData;
  await launched.quit();
  launched = await launchApp(userData);
  page = launched.page;
  await openTab(null);
  expect(await terminalBackground(await activeSessionId())).toBe('rgb(255, 255, 255)');
});
