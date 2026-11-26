import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { bufferText, launchApp, typeInTerminal, type LaunchedApp, pressShortcut } from './harness';

let launched: LaunchedApp;
let page: Page;
let localDir: string;

/** 컨테이너 안에서 btterm 사용자로 실행한다. */
function container(script: string): string {
  return execFileSync(
    'docker',
    ['exec', '-u', 'btterm', '-e', 'HOME=/config', 'btterm-test-target-1', 'sh', '-c', script],
    {
      encoding: 'utf8',
    },
  );
}

/** 셸 통합·테스트 파일 흔적을 지운다(이 컨테이너엔 원래 rc 파일이 없다). 다른 테스트의 셸 출력이 바뀌지 않게 한다. */
function cleanRemote(): void {
  container(
    'rm -rf ~/.bashrc ~/.bash_profile ~/.bashrc.btterm-backup ~/.bash_profile.btterm-backup ~/.config/btterm ~/e2e-files',
  );
}

test.beforeEach(async () => {
  cleanRemote();
  localDir = await mkdtemp(join(tmpdir(), 'btterm-e2e-files-'));
  launched = await launchApp();
  page = launched.page;
});

test.afterEach(async () => {
  await launched.close();
  await rm(localDir, { recursive: true, force: true });
  cleanRemote();
});

/** main 프로세스의 파일 선택 창을 정해진 결과로 대체한다. */
async function stubDialog(filePaths: string[]) {
  await launched.app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: paths,
    })) as typeof dialog.showOpenDialog;
  }, filePaths);
}

async function openTab(hostKey: '신뢰하고 저장' | null) {
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw');
  await page.keyboard.press('Enter');
  if (hostKey) await page.getByRole('button', { name: hostKey }).click();
  await page.locator('.toast').getByRole('button', { name: '닫기' }).click();
}

async function activeSessionId(): Promise<string> {
  const id = await page.locator('.terminal-host[data-active=true]').getAttribute('id');
  return id!.replace(/^panel-/, '');
}

const panel = () => page.getByRole('complementary', { name: '원격 파일' });

test('AC16 셸 통합에 동의하면 새 탭에서 cd할 때 파일 패널이 따라간다', async () => {
  await openTab('신뢰하고 저장');
  await pressShortcut(page, 'focusSftp');
  await panel().getByRole('button', { name: '셸 통합 설치' }).click();
  const consent = page.getByRole('alertdialog');
  await expect(consent).toContainText('# >>> btterm >>>');
  await consent.getByRole('button', { name: '셸 통합 설치' }).click();
  await expect(panel()).toContainText('셸 통합 설치됨');

  // 통합은 새로 연 셸부터 읽힌다.
  await openTab(null);
  const sessionId = await activeSessionId();
  await expect.poll(() => bufferText(page, sessionId), { timeout: 20_000 }).toMatch(/[$#] *$/m);
  await typeInTerminal(page, 'cd /var/log');
  await page.keyboard.press('Enter');
  await expect(panel().getByRole('textbox', { name: '원격 경로' })).toHaveValue('/var/log', {
    timeout: 10_000,
  });
  await expect(panel().getByRole('button', { name: '터미널 폴더 따라가기' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('AC7 한글 파일을 화면에서 내려받고 다시 올리면 이름과 SHA-256이 같다', async () => {
  container(
    "mkdir -p ~/e2e-files/up && printf '보고서 내용 %.0s' $(seq 1 2000) > ~/e2e-files/보고서_최종.txt",
  );
  const remoteHash = container("sha256sum ~/e2e-files/보고서_최종.txt | cut -d' ' -f1").trim();

  await openTab('신뢰하고 저장');
  await pressShortcut(page, 'focusSftp');
  await expect(panel().getByRole('listbox', { name: '/config' })).toBeVisible();
  const path = panel().getByRole('textbox', { name: '원격 경로' });
  await path.fill('/config/e2e-files');
  await path.press('Enter');

  await stubDialog([localDir]);
  await panel().getByText('보고서_최종.txt').dblclick();
  await expect(panel().getByRole('region', { name: '전송' })).toContainText('완료');
  const local = await readFile(join(localDir, '보고서_최종.txt'));
  expect(createHash('sha256').update(local).digest('hex')).toBe(remoteHash);

  await panel().getByText('up').dblclick();
  await expect(path).toHaveValue('/config/e2e-files/up');
  await stubDialog([join(localDir, '보고서_최종.txt')]);
  await panel().getByRole('button', { name: '업로드' }).click();
  await expect(panel().getByRole('option', { name: /보고서_최종\.txt/ })).toBeVisible();
  expect(container("sha256sum ~/e2e-files/up/보고서_최종.txt | cut -d' ' -f1").trim()).toBe(
    remoteHash,
  );
});

test('AC14 전송 중에 앱을 꺼도 5초 안에 끝나고 원격 세션이 남지 않는다', async () => {
  const sessions = () => Number(container("ps -o args | grep -c '[b]tterm@pts' || true").trim());
  const before = sessions();
  const big = join(localDir, 'big.bin');
  await writeFile(big, Buffer.alloc(300 * 1024 * 1024, 3));
  await openTab('신뢰하고 저장');
  await pressShortcut(page, 'focusSftp');
  await expect(panel().getByRole('listbox', { name: '/config' })).toBeVisible();
  await stubDialog([big]);
  await panel().getByRole('button', { name: '업로드' }).click();
  await expect(panel().getByRole('region', { name: '전송' })).toContainText('전송 중');

  const started = Date.now();
  await launched.quit();
  expect(Date.now() - started).toBeLessThan(5000);
  await expect.poll(sessions, { timeout: 10_000 }).toBe(before);
  container('rm -f ~/big.bin ~/big.bin.btterm-part');
});
