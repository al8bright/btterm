import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  bufferText as readBuffer,
  launchApp,
  typeInTerminal as typeIn,
  type LaunchedApp,
} from './harness';

let launched: LaunchedApp;
let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeEach(async () => {
  launched = await launchApp();
  ({ app, page, userData } = launched);
});

test.afterEach(async () => {
  await launched.close();
});

const bufferText = () => readBuffer(page);
const typeInTerminal = (text: string) => typeIn(page, text);

async function quickConnect(password: string) {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', password);
  await page.keyboard.press('Enter');
}

test('AC8 AC9 퀵커넥트 → 호스트 키 신뢰 → 셸 명령 왕복', async () => {
  await quickConnect('btterm-pw');
  await expect(page.getByTestId('hostkey-fingerprint')).toContainText('SHA256:');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();

  await expect.poll(bufferText, { timeout: 20_000 }).toMatch(/[$#] *$/m);
  await typeInTerminal('echo btterm-e2e-$((1+1))');
  await page.keyboard.press('Enter');
  await expect.poll(bufferText, { timeout: 15_000 }).toContain('btterm-e2e-2');

  const knownHosts = await readFile(join(userData, 'known_hosts'), 'utf8');
  expect(knownHosts).toMatch(/^\[127\.0\.0\.1\]:2222 \S+ AAAA/);

  // 앱 시작 시 연결: 실제 safeStorage로 보관소가 열리고(SEC-2), 로그가 남는다(F6.4).
  const vault = JSON.parse(await readFile(join(userData, 'vault.json'), 'utf8'));
  expect(vault.wrappedDek).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  const [logFile] = await readdir(join(userData, 'logs'));
  const log = await readFile(join(userData, 'logs', logFile!), 'utf8');
  expect(log).toContain('앱 시작');
  expect(log).not.toContain('비밀 보관소 사용 불가');
  expect(log).not.toContain('btterm-pw');
});

test('SEC-8 Ctrl+W는 창을 닫지 않고 터미널로 전달된다', async () => {
  await quickConnect('btterm-pw');
  await page.getByRole('button', { name: '이번만 허용' }).click();
  await expect.poll(bufferText, { timeout: 20_000 }).toMatch(/[$#] *$/m);

  // 셸 줄 편집의 Ctrl+W(단어 지우기)가 동작하면 키가 원격까지 갔다는 뜻이다.
  // 앱 메뉴가 가로챘다면 창이 닫히고 "dropme"가 남는다.
  await typeInTerminal('echo keep-$((2+3)) dropme');
  await page.keyboard.press('Control+w');
  await page.keyboard.type('ok');
  await page.keyboard.press('Enter');
  await expect.poll(bufferText, { timeout: 10_000 }).toMatch(/^keep-5 ok$/m);
  expect(app.windows()).toHaveLength(1);
});

test('AC4 접속 후 터미널 크기가 안정되고 창에 스크롤바가 생기지 않는다', async () => {
  await quickConnect('btterm-pw');
  await page.getByRole('button', { name: '이번만 허용' }).click();
  await expect.poll(bufferText, { timeout: 20_000 }).toMatch(/[$#] *$/m);
  // 사용자가 보는 상태처럼 창을 앞에 두고 실제로 그리게 한다(백그라운드 창은 ResizeObserver가 멈춘다).
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.show();
    win?.focus();
    win?.webContents.setBackgroundThrottling(false);
  });

  const sample = () =>
    page.evaluate(() => {
      const root = document.documentElement;
      const screen = document.querySelector('.terminal-host[data-active=true] .xterm-screen');
      return {
        overflow: root.scrollWidth > root.clientWidth || root.scrollHeight > root.clientHeight,
        size: screen ? `${screen.clientWidth}x${screen.clientHeight}` : '',
      };
    });
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await page.screenshot(); // 프레임을 강제로 그려 레이아웃·ResizeObserver를 진행시킨다
    samples.push(await sample());
    await page.waitForTimeout(150);
  }
  expect(samples.some((s) => s.overflow)).toBe(false);
  expect(new Set(samples.map((s) => s.size)).size).toBe(1);
});

test('AC9 호스트 키를 거부하면 연결하지 않고 이유를 보여준다', async () => {
  await quickConnect('btterm-pw');
  await page.getByRole('alertdialog').getByRole('button', { name: '연결 취소' }).click();
  await expect(page.getByRole('alert')).toContainText('호스트 키를 거부');
});
