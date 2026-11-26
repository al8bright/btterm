import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { bufferText, launchApp, typeInTerminal, type LaunchedApp } from './harness';

// 성능 기준선(PRD §7, PLAN 1-7). 결과는 test-results/perf-baseline.json에 남기고
// docs/perf/baseline.md에 옮겨 적는다. AC17만 합격 기준으로 단언한다.

type Hook = { __bttermTest?: { receivedBytes(id: string): number } };

let launched: LaunchedApp;
let page: Page;
const results: Record<string, unknown> = {
  measuredAt: new Date().toISOString(),
  machine: {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memGb: Math.round(totalmem() / 2 ** 30),
    os: release(),
  },
};

test.afterEach(async () => {
  await launched.close();
});

test.afterAll(async () => {
  const dir = join(__dirname, '..', 'test-results');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'perf-baseline.json'), JSON.stringify(results, null, 2));
});

async function activeSessionId(): Promise<string> {
  const id = await page.locator('.terminal-host[data-active=true]').getAttribute('id');
  return id!.replace(/^panel-/, '');
}

async function openTab(trust: boolean) {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  if (trust) await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  const id = await activeSessionId();
  await expect.poll(() => bufferText(page, id), { timeout: 20_000 }).toMatch(/[$#] *$/m);
  await page.locator('.toast').getByRole('button', { name: '닫기' }).click();
  return id;
}

/** 모든 Electron 프로세스의 작업 집합 합계(MB) */
async function totalMemoryMb(): Promise<number> {
  const kb = await launched.app.evaluate(({ app }) =>
    app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0),
  );
  return Math.round(kb / 1024);
}

test('시작 시간: 실행 → 첫 화면', async () => {
  const started = Date.now();
  launched = await launchApp();
  page = launched.page;
  await page.locator('.app').waitFor();
  results.startupMs = Date.now() - started;
});

test('메모리: 탭 1개 / 탭 5개 유휴', async () => {
  launched = await launchApp();
  page = launched.page;
  await openTab(true);
  await page.waitForTimeout(1500);
  const one = await totalMemoryMb();
  for (let i = 0; i < 4; i++) await openTab(false);
  await page.waitForTimeout(1500);
  const five = await totalMemoryMb();
  results.memory = { oneTabMb: one, fiveTabsMb: five, perTabMb: Math.round((five - one) / 4) };
});

test('AC17 대량 출력(yes) 중 Ctrl+C: 200ms 안에 멈추고 이후 추가분 256KB 이하', async () => {
  launched = await launchApp();
  page = launched.page;
  const id = await openTab(true);
  const received = () =>
    page.evaluate(
      (sid) => (globalThis as unknown as Hook).__bttermTest?.receivedBytes(sid) ?? 0,
      id,
    );

  await typeInTerminal(page, 'yes');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  const before = await received();
  const t0 = Date.now();
  await page.keyboard.press('Control+c');
  let last = before;
  let lastChange = t0;
  while (Date.now() - lastChange < 400 && Date.now() - t0 < 5000) {
    const now = await received();
    if (now !== last) {
      last = now;
      lastChange = Date.now();
    }
    await page.waitForTimeout(10);
  }
  const stopMs = lastChange - t0;
  const extraKb = Math.round((last - before) / 1024);
  results.ac17 = { stopMs, extraKb, streamedBeforeKb: Math.round(before / 1024) };
  expect(before).toBeGreaterThan(100 * 1024); // 실제로 대량 출력 중이었다
  expect(stopMs).toBeLessThanOrEqual(200);
  expect(extraKb).toBeLessThanOrEqual(256);
});
