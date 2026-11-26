// 패키징한 앱(Fuses 적용) 스모크: 실행 → 빠른 연결 → 호스트 키 허용 → 셸 명령 왕복 → 종료.
// Docker 테스트 sshd(127.0.0.1:2222)가 필요하다. 실제 사용자 데이터와 분리된 임시 userData를 쓴다.
// 사용: pnpm smoke:packaged [실행 파일 경로]
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { packagedExecutable } from './lib/packagedApp.mjs';

const exe = process.argv[2] ?? packagedExecutable(join(tmpdir(), 'btterm-release'));
const userData = mkdtempSync(join(tmpdir(), 'btterm-smoke-'));
const port = 9300 + Math.floor(Math.random() * 500);

// 출시 빌드는 BTTERM_USER_DATA를 따르지 않으므로 Chromium 표준 스위치로 데이터 폴더를 분리한다.
// macOS: 실제 로그인 키체인 대신 Chromium 모의 키체인을 쓴다. ad-hoc 서명 앱은 빌드마다 서명이 바뀌어
// 기존 Safe Storage 항목에 접근할 때 암호 확인 창이 떠서 자동 실행이 멈춘다(PLAN 부록 B).
const keychain = process.platform === 'darwin' ? ['--use-mock-keychain'] : [];
const child = spawn(
  exe,
  [...keychain, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { stdio: 'ignore' },
);

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('패키징 앱에 연결하지 못했습니다(시작 실패?)');
}

let exitCode = 1;
try {
  const browser = await connect();
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith('app://'));
  if (!page) throw new Error('app:// 창이 없습니다');
  await page.fill('input[name=target]', 'btterm@127.0.0.1:2222');
  await page.keyboard.press('Enter');
  await page.fill('input[name=secret]', 'btterm-pw', { timeout: 15_000 });
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '이번만 허용' }).click({ timeout: 15_000 });
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.waitForTimeout(1000);
  // WebGL 렌더러는 글자를 DOM에 그리지 않으므로, 원격에 파일을 쓰게 하고 컨테이너에서 확인한다.
  const marker = `/tmp/smoke-${randomUUID()}`;
  await page.keyboard.type(`echo packaged-$((20+22)) > ${marker}`);
  await page.keyboard.press('Enter');
  let written = '';
  for (let i = 0; i < 50 && !written.includes('packaged-42'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      written = execFileSync('docker', ['exec', 'btterm-test-target-1', 'cat', marker], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      written = '';
    }
  }
  if (!written.includes('packaged-42')) throw new Error('원격 셸에서 명령 결과를 찾지 못했습니다');
  execFileSync('docker', ['exec', 'btterm-test-target-1', 'rm', '-f', marker]);
  console.log('smoke: 패키징 앱 실행·접속·명령 왕복 확인');
  await browser.close();
  exitCode = 0;
} catch (error) {
  console.error(`smoke: 실패 — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  rmSync(userData, { recursive: true, force: true });
  process.exit(exitCode);
}
