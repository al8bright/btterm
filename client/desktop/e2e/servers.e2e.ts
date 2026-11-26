import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { opensshEd25519 } from '../test/keys';
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

const tree = () => page.getByRole('tree', { name: '서버 목록' });

async function createGroup(name: string, options: { port?: string; icon?: string } = {}) {
  await page.getByRole('button', { name: '새 그룹' }).click();
  const dialog = page.getByRole('dialog', { name: '새 그룹' });
  await dialog.locator('input[name=group-name]').fill(name);
  if (options.port) await dialog.locator('input[name=group-port]').fill(options.port);
  if (options.icon) await dialog.getByRole('radio', { name: options.icon, exact: true }).click();
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(dialog).toHaveCount(0);
}

test('F1.1 AC29 그룹 기본 포트·아이콘을 물려받는 서버를 화면에서 만들고 접속한다', async () => {
  await createGroup('Prod', { port: '2222', icon: '데이터베이스' });

  await tree().getByRole('treeitem', { name: 'Prod' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '이 그룹에 새 서버' }).click();
  const dialog = page.getByRole('dialog', { name: '새 서버' });
  await expect(dialog).toContainText('상속: Prod (2222)');
  await dialog.locator('input[name=name]').fill('target');
  await dialog.locator('input[name=host]').fill('127.0.0.1');
  await dialog.locator('input[name=username]').fill('btterm');
  await dialog.locator('select[name=identity]').selectOption('__new__');
  await dialog.locator('input[name=password]').fill('btterm-pw');
  await dialog.getByRole('button', { name: '저장 후 접속' }).click();

  await page.getByRole('button', { name: '이번만 허용' }).click();
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/[$#] *$/m);
  await expect(page.getByRole('tab', { name: /target/ })).toBeVisible();

  const row = tree()
    .getByRole('treeitem', { name: /target 127\.0\.0\.1/ })
    .last();
  await expect(row.locator('.icon-tile')).toHaveAttribute('data-icon', 'database');

  // 하위 서버 하나만 web으로 재정의
  await row.press('F2');
  const edit = page.getByRole('dialog', { name: '서버 편집' });
  await edit.getByRole('radio', { name: '웹', exact: true }).click();
  await edit.getByRole('button', { name: '저장', exact: true }).click();
  await expect(row.locator('.icon-tile')).toHaveAttribute('data-icon', 'web');
});

test('F7 키 관리: 경로 참조 키를 추가하면 지문이 보이고, 지울 수 있다', async () => {
  const key = opensshEd25519('pp-ui');
  const dir = await mkdtemp(join(tmpdir(), 'btterm-e2e-key-'));
  const keyPath = join(dir, 'id_ui');
  await writeFile(keyPath, key.privateKey);
  try {
    await page.getByRole('button', { name: '키 관리' }).click();
    await page.getByRole('button', { name: '키 추가' }).click();
    const dialog = page.getByRole('dialog', { name: '개인키 추가' });
    await dialog.locator('input[name=key-label]').fill('ui-key');
    await dialog.locator('input[name=key-path]').fill(keyPath);
    await dialog.getByRole('button', { name: '키 추가' }).click();
    await expect(dialog.getByRole('alert')).toContainText('키 암호를 입력하세요');

    await dialog.locator('input[name=key-passphrase]').fill('pp-ui');
    await dialog.getByRole('button', { name: '키 추가' }).click();
    const keys = page.getByRole('dialog', { name: '키 관리' });
    await expect(keys).toContainText('ui-key');
    await expect(keys).toContainText('SHA256:');
    await expect(keys).toContainText('암호 보호됨');

    await keys.getByRole('button', { name: '키 삭제' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click();
    await expect(keys).toContainText('등록된 키가 없습니다');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('F1.3 빠른 연결 뒤 저장 토스트로 서버 목록에 남긴다', async () => {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '이번만 허용' }).click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText('btterm@127.0.0.1:2222');
  await toast.getByRole('button', { name: '저장' }).click();
  await expect(
    tree()
      .getByRole('treeitem', { name: /127\.0\.0\.1/ })
      .first(),
  ).toBeVisible();
});
