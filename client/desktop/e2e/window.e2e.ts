import { expect, test, type Page } from '@playwright/test';
import { appPlatform, bufferText, launchApp, type LaunchedApp } from './harness';

let launched: LaunchedApp;
let page: Page;

test.beforeEach(async () => {
  launched = await launchApp();
  page = launched.page;
});

test.afterEach(async () => {
  await launched.close();
});

// 더블클릭 최대화·스냅 레이아웃은 OS가 처리해 자동 테스트로 재현할 수 없다. 여기서는 그 전제를 검사한다.
// macOS 26 신호등의 오른쪽 끝(약 79px). 헤더 왼쪽 여백(92px) 안에 있어야 한다
const MAC_TRAFFIC_LIGHTS_RIGHT = 80;

/** macOS: 신호등 자리를 비우고, 끌기 영역·헤더 높이는 Windows와 같다 */
async function expectMacHeader(): Promise<void> {
  await page.locator('.header .brand').waitFor();
  const layout = await page.evaluate(() => {
    const region = (el: Element | null) =>
      el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') : null;
    return {
      header: region(document.querySelector('.header')),
      quick: region(document.querySelector('.quick')),
      brandLeft: document.querySelector('.brand')!.getBoundingClientRect().left,
      headerHeight: document.querySelector('.header')!.getBoundingClientRect().height,
    };
  });
  expect(layout.header).toBe('drag');
  expect(layout.quick).toBe('no-drag');
  expect(layout.brandLeft).toBeGreaterThanOrEqual(MAC_TRAFFIC_LIGHTS_RIGHT);
  expect(layout.headerHeight).toBe(48);
}

test('DESIGN §4.2 헤더가 제목 표시줄을 겸한다: 빈 곳은 끌기, 입력은 끌기 제외, 창 버튼 자리는 비운다', async () => {
  await page.locator('.header').waitFor();
  if ((await appPlatform(page)) === 'mac') {
    await expectMacHeader();
    return;
  }
  const layout = await page.evaluate(() => {
    const overlay = (
      navigator as Navigator & {
        windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect };
      }
    ).windowControlsOverlay;
    const region = (el: Element | null) =>
      el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') : null;
    const quick = document.querySelector('.quick input')!.getBoundingClientRect();
    const area = overlay?.getTitlebarAreaRect();
    return {
      overlay: overlay?.visible ?? false,
      header: region(document.querySelector('.header')),
      quick: region(document.querySelector('.quick')),
      quickRight: quick.right,
      areaRight: area ? area.x + area.width : 0,
      headerBottom: document.querySelector('.header')!.getBoundingClientRect().bottom,
    };
  });
  expect(layout.overlay).toBe(true);
  expect(layout.header).toBe('drag');
  expect(layout.quick).toBe('no-drag');
  expect(layout.quickRight).toBeLessThanOrEqual(layout.areaRight);
  expect(layout.headerBottom).toBe(48);

  // 창 버튼이 그려지는 자리(제목 표시줄 영역 밖)는 화면 요소가 쓰지 않는다
  const covered = await page.evaluate(() => {
    const overlay = (
      navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }
    ).windowControlsOverlay.getTitlebarAreaRect();
    const x = overlay.x + overlay.width + 10;
    return document.elementFromPoint(x, 20)?.closest('button, input, a') != null;
  });
  expect(covered).toBe(false);
});

test('DESIGN §4.2 대화상자가 열려 있으면 헤더 끌기를 끈다(헤더 위로 옮긴 대화상자도 클릭되게)', async () => {
  const region = () =>
    page.evaluate(() =>
      getComputedStyle(document.querySelector('.header')!).getPropertyValue('-webkit-app-region'),
    );
  await page.getByRole('button', { name: '새 서버 추가' }).first().click();
  await expect(page.getByRole('dialog', { name: '새 서버' })).toBeVisible();
  expect(await region()).toBe('no-drag');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await region()).toBe('drag');
});

test('F6.7 창 위치·크기와 최대화를 기억해 다음 실행 때 그대로 연다', async () => {
  const winOf = (app: LaunchedApp['app']) =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return { bounds: w.getContentBounds(), maximized: w.isMaximized() };
    });
  await launched.app.evaluate(
    ({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0]!.setContentBounds(b),
    { x: 120, y: 90, width: 1100, height: 700 },
  );
  // OS가 테두리만큼 내용 영역 위치를 맞추므로 실제로 놓인 값을 기준으로 삼는다(크기는 그대로)
  const target = (await winOf(launched.app)).bounds;
  expect(target).toMatchObject({ width: 1100, height: 700 });
  const userData = launched.userData;
  await launched.quit();

  launched = await launchApp(userData);
  page = launched.page;
  await expect.poll(async () => (await winOf(launched.app)).bounds).toEqual(target);

  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize());
  await launched.quit();
  launched = await launchApp(userData);
  page = launched.page;
  await expect.poll(async () => (await winOf(launched.app)).maximized).toBe(true);
  // 최대화를 풀면 지난번 일반 크기로 돌아간다
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.unmaximize(),
  );
  await expect.poll(async () => (await winOf(launched.app)).bounds).toEqual(target);
});

test('F6.9 앱을 다시 켜면 이전 탭을 다시 열 수 있다(비밀번호는 다시 묻는다)', async () => {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  await expect(page.getByRole('tab', { name: /btterm@127\.0\.0\.1/ })).toBeVisible();
  await page.waitForTimeout(600); // 칸 배치 저장(300ms 모아서)

  const userData = launched.userData;
  await launched.quit();
  launched = await launchApp(userData);
  page = launched.page;

  await page.getByRole('button', { name: '이전 탭 1개 다시 열기' }).click();
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /btterm@127\.0\.0\.1/ })).toBeVisible();
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/[$#] *$/m);
});

test('DESIGN §4.2 창을 최대화하면 헤더 높이가 그대로이고 버튼 자리를 다시 비운다', async () => {
  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize());
  await expect
    .poll(() =>
      launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()),
    )
    .toBe(true);
  if ((await appPlatform(page)) === 'mac') {
    await expectMacHeader();
    return;
  }
  const header = (await page.locator('.header').boundingBox())!;
  expect(header.height).toBe(48);
  const fits = await page.evaluate(() => {
    const area = (
      navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }
    ).windowControlsOverlay.getTitlebarAreaRect();
    return (
      document.querySelector('.quick input')!.getBoundingClientRect().right <= area.x + area.width
    );
  });
  expect(fits).toBe(true);
});
