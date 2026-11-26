import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { bufferText, launchApp, typeInTerminal, type LaunchedApp } from './harness';

let launched: LaunchedApp;
let page: Page;

test.beforeEach(async () => {
  launched = await launchApp();
  page = launched.page;
});

test.afterEach(async () => {
  await launched.close();
});

async function quickConnect(password: string) {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', password);
  await page.keyboard.press('Enter');
}

async function run(command: string) {
  await typeInTerminal(page, command);
  await page.keyboard.press('Enter');
}

test('DF1 호스트 키 확인창이 떠 있는 동안 탭이 닫히면 확인창도 사라진다', async () => {
  await quickConnect('btterm-pw');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  // 확인창이 뜨기 직전에 연결 중 안내의 "연결 취소"를 누른 경우와 같다(확인창 뒤라 마우스로는 못 누름)
  await page.evaluate(() =>
    (document.querySelector('.connecting button') as HTMLButtonElement).click(),
  );
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('AC1 vim에 들어갔다 :q!로 나오면 원래 화면과 프롬프트가 돌아온다', async () => {
  await quickConnect('btterm-pw');
  await page.getByRole('button', { name: '이번만 허용' }).click();
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/[$#] *$/m);
  await run('echo before-vim-$((5*5))');
  await expect.poll(() => bufferText(page)).toContain('before-vim-25');

  await run('vim /tmp/ac1-test.txt');
  // 대체 화면: 이전 출력은 보이지 않고 vim의 빈 줄 표시(~)가 보인다.
  await expect.poll(() => bufferText(page), { timeout: 10_000 }).toMatch(/^~\s*$/m);
  expect(await bufferText(page)).not.toContain('before-vim-25');

  await page.keyboard.press('Escape');
  await page.keyboard.type(':q!');
  await page.keyboard.press('Enter');
  await expect.poll(() => bufferText(page), { timeout: 10_000 }).toContain('before-vim-25');
  expect(await bufferText(page)).toMatch(/[$#] *$/m);
  expect(await bufferText(page)).not.toMatch(/^~\s*$/m);
});

test('AC10 저장된 키와 다른 호스트 키는 경고하고 연결을 거부한다', async () => {
  // 앱 known_hosts에 다른 키를 미리 넣어 둔다(테스트 데이터 폴더 안).
  await writeFile(
    join(launched.userData, 'known_hosts'),
    '[127.0.0.1]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n',
  );
  await quickConnect('btterm-pw');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('호스트 키가 변경되었습니다');
  await expect(dialog).toContainText('저장된 키');
  // 불일치에서는 허용 버튼이 없다(SEC-3).
  await expect(dialog.getByRole('button', { name: '이번만 허용' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '신뢰하고 저장' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '연결 취소' }).click();
  await expect(page.getByRole('alert')).toContainText('호스트 키를 거부');
});

test('AC15 잘못된 비밀번호는 오류를 보여 주고, 다시 연결로 재시도할 수 있으며 로그에 남지 않는다', async () => {
  await quickConnect('wrong-password-xyz');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  const banner = page.getByRole('alert');
  await expect(banner).toContainText('인증에 실패했습니다', { timeout: 20_000 });

  // 끝난 세션은 인증 정보를 지웠으므로 다시 연결하면 비밀번호를 다시 묻는다.
  await banner.getByRole('button', { name: '다시 연결' }).click();
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/[$#] *$/m);
  await expect(page.getByRole('tab', { name: /연결됨/ })).toBeVisible();

  await launched.quit();
  const logDir = join(launched.userData, 'logs');
  const logs = await Promise.all(
    (await readdir(logDir)).map((f) => readFile(join(logDir, f), 'utf8')),
  );
  expect(logs.join('\n')).toContain('auth-failed');
  expect(logs.join('\n')).not.toContain('wrong-password-xyz');
  expect(logs.join('\n')).not.toContain('btterm-pw');
});
