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

async function activeSessionId(): Promise<string> {
  const id = await page.locator('.terminal-host[data-active=true]').getAttribute('id');
  return id!.replace(/^panel-/, '');
}

async function openTab(hostKey: '신뢰하고 저장' | null) {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  if (hostKey) await page.getByRole('button', { name: hostKey }).click();
  const id = await activeSessionId();
  await expect.poll(() => bufferText(page, id), { timeout: 20_000 }).toMatch(/[$#] *$/m);
  return id;
}

/** 칸을 눌러 활성으로 만든 뒤 명령을 친다. */
async function runIn(id: string, command: string) {
  await page.locator(`#panel-${id}`).click();
  await expect(page.locator(`#panel-${id}`)).toHaveAttribute('data-active', 'true');
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

const tabOf = (id: string) => page.locator(`[role=tab][aria-controls="panel-${id}"]`);

/** 원격 `stty size`의 열 수(마커로 이번 출력만 읽는다). */
async function remoteCols(id: string, mark: string): Promise<number> {
  return (await remoteSize(id, mark)).cols;
}

async function remoteSize(id: string, mark: string): Promise<{ rows: number; cols: number }> {
  await runIn(id, `echo ${mark}-$(stty size | tr ' ' x)`);
  const pattern = new RegExp(`^${mark}-(\\d+)x(\\d+)\\s*$`, 'gm');
  await expect.poll(() => bufferText(page, id), { timeout: 10_000 }).toMatch(pattern);
  // 같은 마커로 다시 물을 수 있으므로 마지막 출력을 읽는다.
  const last = [...(await bufferText(page, id)).matchAll(pattern)].at(-1)!;
  return { rows: Number(last[1]), cols: Number(last[2]) };
}

test('AC33 탭을 오른쪽 가장자리로 끌어 놓으면 칸이 나뉘고 각 칸 위에 자기 탭바가 있으며 크기가 칸에 맞는다', async () => {
  const first = await openTab('신뢰하고 저장');
  const fullCols = await remoteCols(first, 'full');
  const second = await openTab(null);
  await expect(page.getByRole('tablist')).toHaveCount(1);

  // 보고 있는 두 번째 탭 터미널의 오른쪽 가장자리에 첫 번째 탭을 끌어 놓는다.
  const body = page.locator('.pane-body');
  const box = (await body.boundingBox())!;
  await page
    .getByRole('tab', { name: /btterm@127\.0\.0\.1/ })
    .first()
    .dragTo(body, { targetPosition: { x: box.width - 20, y: box.height / 2 } });

  await expect(page.getByRole('tablist')).toHaveCount(2);
  await expect(page.locator(`#panel-${first}`)).toHaveAttribute('data-visible', 'true');
  await expect(page.locator(`#panel-${second}`)).toHaveAttribute('data-visible', 'true');
  const left = (await page.locator(`#panel-${second}`).boundingBox())!;
  const right = (await page.locator(`#panel-${first}`).boundingBox())!;
  expect(right.x).toBeGreaterThan(left.x + left.width / 2);

  // 각 칸의 탭바는 그 칸 바로 위에 있다.
  for (const [id, pane] of [
    [first, right],
    [second, left],
  ] as const) {
    const tab = (await page.locator(`[role=tab][aria-controls="panel-${id}"]`).boundingBox())!;
    expect(tab.y + tab.height).toBeLessThanOrEqual(pane.y + 1);
    expect(tab.x).toBeGreaterThanOrEqual(pane.x - 1);
    expect(tab.x).toBeLessThan(pane.x + pane.width);
  }

  // 각 원격 PTY 열 수가 절반 칸에 맞게 줄었다.
  await expect.poll(() => remoteCols(first, 'r1')).toBeLessThan(fullCols * 0.6);
  await expect.poll(() => remoteCols(second, 'l1')).toBeLessThan(fullCols * 0.6);

  // 각 칸 입력은 그 세션에만 간다.
  await runIn(second, 'echo only-$((40+2))-left');
  await expect.poll(() => bufferText(page, second)).toContain('only-42-left');
  expect(await bufferText(page, first)).not.toContain('only-42-left');

  // 오른쪽 칸의 마지막 탭을 닫으면 칸이 사라지고 남은 칸이 전체 화면.
  // 저장 토스트는 오른쪽 아래라 칸 탭바를 가리지 않는다.
  await expect(page.locator('.toast')).toBeVisible();
  await page.locator(`[role=tab][aria-controls="panel-${first}"] + .tab-close`).click();
  await expect(page.getByRole('tablist')).toHaveCount(1);
  await expect(page.locator(`#panel-${second}`)).toHaveAttribute('data-split', 'false');
  await expect.poll(() => remoteCols(second, 'back')).toBe(fullCols);
});

test('AC33 좌우로 나뉜 오른쪽 칸을 다시 위아래로 나누면 세 칸이 되고 각 크기가 칸에 맞는다', async () => {
  const first = await openTab('신뢰하고 저장');
  const full = await remoteSize(first, 'full');
  const second = await openTab(null);

  // 좌우 분할: [second] | [first]
  const body = page.locator('.pane-body');
  const box = (await body.boundingBox())!;
  await tabOf(first).dragTo(body, { targetPosition: { x: box.width - 20, y: box.height / 2 } });
  await expect(page.getByRole('tablist')).toHaveCount(2);

  // 오른쪽 칸(활성)에 세 번째 연결을 열고, 그 탭을 오른쪽 칸 아래 가장자리로
  const third = await openTab(null);
  const rightBody = page.locator('.pane-body').nth(1);
  const rightBox = (await rightBody.boundingBox())!;
  // 놓을 자리(오른쪽 아래)에 저장 토스트가 떠 있다. 끄는 동안에는 토스트가 놓기를 막지 않아야 하므로
  // dragTo의 사전 가림 검사 없이 마우스로 직접 끈다.
  const tabBox = (await tabOf(third).boundingBox())!;
  await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height - 20, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.getByRole('tablist')).toHaveCount(3);

  const left = (await page.locator(`#panel-${second}`).boundingBox())!;
  const top = (await page.locator(`#panel-${first}`).boundingBox())!;
  const bottom = (await page.locator(`#panel-${third}`).boundingBox())!;
  expect(top.x).toBeGreaterThan(left.x + left.width / 2);
  expect(Math.abs(bottom.x - top.x)).toBeLessThan(2);
  expect(bottom.y).toBeGreaterThan(top.y + top.height / 2);
  expect(left.height).toBeGreaterThan(top.height * 1.5);

  // 위아래 칸은 열이 절반, 행도 절반쯤. 왼쪽 칸은 행이 그대로다.
  await expect.poll(async () => (await remoteSize(third, 'b1')).rows).toBeLessThan(full.rows * 0.6);
  expect((await remoteSize(third, 'b2')).cols).toBeLessThan(full.cols * 0.6);
  await expect.poll(async () => (await remoteSize(first, 't1')).rows).toBeLessThan(full.rows * 0.6);
  expect((await remoteSize(second, 'l1')).rows).toBe(full.rows);
});
