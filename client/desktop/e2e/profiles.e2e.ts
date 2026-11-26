import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { RendererToMainRequest } from '@btterm/core';
import { opensshEd25519, type TestKey } from '../test/keys';
import { bufferText, launchApp, readAllFiles, typeInTerminal, type LaunchedApp } from './harness';

let launched: LaunchedApp;
let page: Page;

async function start(userData?: string): Promise<void> {
  launched = await launchApp(userData);
  page = launched.page;
}

test.beforeEach(() => start());

test.afterEach(async () => {
  await launched.close();
});

function authorize(key: TestKey): void {
  execFileSync('docker', [
    'exec',
    'btterm-test-target-1',
    'sh',
    '-c',
    `echo '${key.publicLine}' >> /config/.ssh/authorized_keys`,
  ]);
}

// 프로필 편집 UI 전이라 저장은 preload API로 하고, 접속은 사이드바에서 한다.
function invoke(request: RendererToMainRequest): Promise<Record<string, unknown>> {
  type WithApi = { btterm: { invoke(r: RendererToMainRequest): Promise<unknown> } };
  return page.evaluate(
    (req) =>
      (globalThis as unknown as WithApi).btterm.invoke(req) as Promise<Record<string, unknown>>,
    request,
  );
}

async function saveIdentity(
  auth: Extract<RendererToMainRequest, { type: 'profiles.saveIdentity' }>['auth'],
) {
  const { identityId } = await invoke({
    type: 'profiles.saveIdentity',
    identity: { label: 'btterm', username: 'btterm' },
    auth,
  });
  return identityId as string;
}

async function saveProfile(name: string, identityId: string): Promise<void> {
  await invoke({
    type: 'profiles.saveProfile',
    profile: {
      id: `p-${name}`,
      groupId: null,
      name,
      host: '127.0.0.1',
      overrides: { port: 2222, identityId },
      tags: [],
      updatedAt: 0,
    },
  });
}

/** 트리의 서버 행을 더블클릭한다. 고정 구역에도 나올 수 있어 전체 트리 쪽(마지막)을 쓴다. */
async function openFromSidebar(name: string): Promise<void> {
  await page
    .getByRole('tree', { name: '서버 목록' })
    .getByRole('treeitem', { name: new RegExp(`^${name} `) })
    .last()
    .dblclick();
}

async function waitForPrompt(): Promise<void> {
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/[$#] *$/m);
}

async function roundTrip(marker: string): Promise<void> {
  await typeInTerminal(page, `echo ${marker}-$((40+2))`);
  await page.keyboard.press('Enter');
  await expect.poll(() => bufferText(page), { timeout: 15_000 }).toContain(`${marker}-42`);
}

test('AC26 보관소 비밀번호·가져온 암호화 키로 접속하고, 데이터 폴더 어디에도 평문 비밀이 없다', async () => {
  const key = opensshEd25519('pp-ac26');
  authorize(key);
  const keyText = new TextDecoder().decode(key.privateKey);
  const { keyId } = await invoke({
    type: 'keys.importText',
    label: 'imported',
    text: keyText,
    passphrase: 'pp-ac26',
    passphrasePolicy: 'vault',
  });
  await saveProfile('vault-pw', await saveIdentity({ kind: 'password', password: 'btterm-pw' }));
  await saveProfile('vault-key', await saveIdentity({ kind: 'key', keyId: keyId as string }));

  await openFromSidebar('vault-pw');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  await waitForPrompt();
  await roundTrip('vault-pw');

  await openFromSidebar('vault-key');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/[$#] *$/m);
  await roundTrip('vault-key');
  await expect(page.locator('input[name=secret]')).toHaveCount(0); // 비밀번호·passphrase를 묻지 않았다

  await launched.quit();
  const everything = await readAllFiles(launched.userData);
  expect(everything).toContain('vault-key'); // 프로필은 저장됐고
  expect(everything).not.toContain('PRIVATE KEY');
  expect(everything).not.toContain('pp-ac26');
  expect(everything).not.toContain('btterm-pw');
});

test('AC27 경로 참조 키의 passphrase는 앱 실행 동안만 기억하고 재시작하면 다시 묻는다', async () => {
  const key = opensshEd25519('pp-ac27');
  authorize(key);
  const keyDir = await mkdtemp(join(tmpdir(), 'btterm-e2e-key-'));
  const keyPath = join(keyDir, 'id_ed25519');
  await writeFile(keyPath, key.privateKey);
  try {
    const { keyId } = await invoke({
      type: 'keys.addFromPath',
      label: 'path-key',
      path: keyPath,
      passphrase: 'pp-ac27', // 등록 때 형식 검증에만 쓰고 저장하지 않는다(F7.3)
      passphrasePolicy: 'ask',
    });
    const identityId = await saveIdentity({ kind: 'key', keyId: keyId as string });
    await saveProfile('first', identityId);
    await saveProfile('second', identityId);

    const answerPassphrase = async () => {
      await page.fill('input[name=secret]', 'pp-ac27');
      await page.keyboard.press('Enter');
    };

    await openFromSidebar('first');
    await answerPassphrase();
    await page.getByRole('button', { name: '신뢰하고 저장' }).click();
    await waitForPrompt();

    await openFromSidebar('second');
    await expect(page.getByRole('tab')).toHaveCount(2);
    await roundTrip('second');
    await expect(page.locator('input[name=secret]')).toHaveCount(0);

    const userData = launched.userData;
    await launched.quit();
    await start(userData);
    await openFromSidebar('first');
    await expect(page.locator('input[name=secret]')).toBeVisible();
    await answerPassphrase();
    await waitForPrompt();
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }
});

test('AC28 경로 참조 키 파일이 사라지면 연결 전에 알리고 고칠 방법을 안내한다', async () => {
  const key = opensshEd25519();
  const keyDir = await mkdtemp(join(tmpdir(), 'btterm-e2e-key-'));
  const keyPath = join(keyDir, 'id_ed25519');
  await writeFile(keyPath, key.privateKey);
  const { keyId } = await invoke({
    type: 'keys.addFromPath',
    label: 'gone',
    path: keyPath,
    passphrasePolicy: 'ask',
  });
  await saveProfile('gone', await saveIdentity({ kind: 'key', keyId: keyId as string }));
  await rm(keyDir, { recursive: true, force: true });

  await openFromSidebar('gone');
  await expect(page.getByRole('alert')).toContainText('키 파일을 찾을 수 없습니다');
  await expect(page.getByRole('alert')).toContainText('가져오기');
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('F6.11 연결 직후 명령을 셸이 준비되면 한 번 실행한다', async () => {
  const identityId = await saveIdentity({ kind: 'password', password: 'btterm-pw' });
  await invoke({
    type: 'profiles.saveProfile',
    profile: {
      id: 'p-startup',
      groupId: null,
      name: 'startup',
      host: '127.0.0.1',
      overrides: { port: 2222, identityId, startupCommand: 'echo startup-$((40+2))' },
      tags: [],
      updatedAt: 0,
    },
  });
  await openFromSidebar('startup');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  await expect.poll(() => bufferText(page), { timeout: 20_000 }).toMatch(/^startup-42\s*$/m);
});

test('AC12 서버 쪽 연결이 끊기면 자동으로 다시 연결하고 같은 탭에서 이어 쓴다', async () => {
  await saveProfile('reconnect', await saveIdentity({ kind: 'password', password: 'btterm-pw' }));
  await openFromSidebar('reconnect');
  await page.getByRole('button', { name: '신뢰하고 저장' }).click();
  await waitForPrompt();
  await roundTrip('before');

  execFileSync('docker', [
    'exec',
    '-u',
    'btterm',
    'btterm-test-target-1',
    'pkill',
    '-KILL',
    '-f',
    'btterm@pts',
  ]);
  await expect(page.getByRole('status')).toContainText('다시 시도합니다', { timeout: 10_000 });
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('tab')).toHaveCount(1);
  await roundTrip('after');
});
