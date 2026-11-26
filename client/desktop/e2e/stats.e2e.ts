import { expect, test, type Page } from '@playwright/test';
import { bufferText, launchApp, type LaunchedApp } from './harness';

let launched: LaunchedApp;
let page: Page;

test.beforeEach(async () => {
  launched = await launchApp();
  page = launched.page;
});

test.afterEach(async () => {
  await launched.close();
});

test('AC34 접속하면 칸 아래 상태 줄에 서버 상태가 채워지고, 좁아지면 ◀ ▶로 넘겨 본다', async () => {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/[$#] *$/m);

  const bar = page.getByRole('group', { name: '서버 상태' });
  // 칸 안, 터미널 아래
  const terminal = (await page.locator('.terminal-host').boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y).toBeGreaterThanOrEqual(terminal.y + terminal.height - 1);

  await expect(bar.locator('[data-stat=user] .stat-value')).toHaveText('btterm', {
    timeout: 10_000,
  });
  await expect(bar.locator('[data-stat=os] .stat-value')).not.toHaveText('—');
  await expect(bar.locator('[data-stat=ram] .stat-value')).toContainText(' / ');
  await expect(bar.locator('[data-stat=disk] .stat-value')).toContainText('%');
  // 두 번째 표본(3초 뒤)부터 CPU%·네트워크 속도
  await expect(bar.locator('[data-stat=cpu] .stat-value')).toHaveText(/^\d+%$/, {
    timeout: 10_000,
  });
  await expect(bar.locator('[data-stat=net] .stat-value')).toContainText('↑');

  // 창이 넓으면 버튼 없음 → 좁히면 ◀ ▶가 생기고 넘겨진다(스크롤바 없음)
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(1600, 900),
  );
  await expect(bar.getByRole('button', { name: '다음 항목' })).toHaveCount(0);
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(820, 700),
  );
  const next = bar.getByRole('button', { name: '다음 항목' });
  await expect(next).toBeVisible();
  await expect(bar.getByRole('button', { name: '이전 항목' })).toBeDisabled();
  const track = bar.locator('.stats-track');
  await next.click();
  await expect(track).not.toHaveAttribute('style', /translateX\(-0px\)/);
  const overflowX = await bar
    .locator('.stats-viewport')
    .evaluate((el) => getComputedStyle(el).overflowX);
  expect(overflowX).toBe('hidden');
});
