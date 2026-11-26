import { expect, test, type Page } from '@playwright/test';
import { bufferText, launchApp, type LaunchedApp, pressShortcut } from './harness';

let launched: LaunchedApp;
let page: Page;

test.beforeEach(async () => {
  launched = await launchApp();
  page = launched.page;
});

test.afterEach(async () => {
  await launched.close();
});

async function openTab() {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  const id = (await page.locator('.terminal-host[data-active=true]').getAttribute('id'))!;
  const sessionId = id.replace(/^panel-/, '');
  await expect.poll(() => bufferText(page, sessionId), { timeout: 20_000 }).toMatch(/[$#] *$/m);
}

const toggles = () => page.getByRole('button', { name: '도구 패널 열기·닫기' });
const panel = () => page.getByRole('complementary', { name: '터미널 도구 패널' });

test('UX8 탭바의 도구 패널 버튼으로 그 칸 안에 패널을 열고 닫는다', async () => {
  await openTab();
  await expect(
    page.locator('.tabbar').getByRole('button', { name: '도구 패널 열기·닫기' }),
  ).toBeVisible();

  await toggles().click();
  await expect(panel()).toBeVisible();
  const paneBox = (await page.locator('.pane-body').boundingBox())!;
  const panelBox = (await panel().boundingBox())!;
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);
  expect(panelBox.x).toBeGreaterThan(paneBox.x);
  await expect(toggles()).toHaveAttribute('aria-expanded', 'true');

  await toggles().click();
  await expect(panel()).toHaveCount(0);
});

test('UX8 칸을 나누면 칸마다 버튼이 있고, 다른 칸의 버튼은 그 칸에 패널을 연다', async () => {
  await openTab();
  await pressShortcut(page, 'splitSameServer');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tablist')).toHaveCount(2);
  await expect(toggles()).toHaveCount(2);

  const groups = page.locator('.pane-group');
  await toggles().first().click();
  await expect(groups.first()).toHaveAttribute('data-focused', 'true');
  await expect(
    groups.first().getByRole('complementary', { name: '터미널 도구 패널' }),
  ).toBeVisible();
});
