// Windows 설치 파일 패키징. P: 같은 가상·동기화 드라이브에서는 electron-builder가 압축 해제한
// .asar를 지우다 EBUSY로 실패하므로, 로컬 임시 폴더에서 패키징한 뒤 결과만 release/로 복사한다.
// 사용: pnpm package:win   →  client/desktop/release/<버전>/ (설치 파일, SHA256SUMS.txt)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedExecutable } from './lib/packagedApp.mjs';

const desktop = fileURLToPath(new URL('../desktop/', import.meta.url));
const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
export const BUILD_DIR = join(tmpdir(), 'btterm-release');

function run(command, args) {
  // pnpm·electron-builder는 Windows에서 .cmd라 셸이 필요하다. 인자는 고정 값만 쓴다.
  execFileSync(command, args, {
    cwd: desktop,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

rmSync(BUILD_DIR, { recursive: true, force: true });
run('pnpm', ['exec', 'electron-vite', 'build']);
run('pnpm', [
  'exec',
  'electron-builder',
  '--win',
  'nsis',
  '--publish',
  'never',
  `--config.directories.output=${BUILD_DIR}`,
]);

const target = join(desktop, 'release', version);
mkdirSync(target, { recursive: true });
const sums = [];
for (const name of readdirSync(BUILD_DIR)) {
  if (!name.endsWith('.exe')) continue;
  copyFileSync(join(BUILD_DIR, name), join(target, name));
  const hash = createHash('sha256')
    .update(readFileSync(join(BUILD_DIR, name)))
    .digest('hex');
  sums.push(`${hash}  ${name}`);
}
writeFileSync(join(target, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(`package: ${target}`);
console.log(`package: 압축 해제본 ${packagedExecutable(BUILD_DIR, 'win32')}`);
