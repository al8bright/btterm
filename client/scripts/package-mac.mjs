// macOS 설치 파일(dmg, universal, ad-hoc 서명) 패키징(결정 M2). 맥에서만 만들 수 있다(M2-3).
// 사용: pnpm package:mac   →  client/desktop/release/<버전>/ (dmg, SHA256SUMS-mac.txt)
// 자동 업데이트는 없다(M2-5): latest-mac.yml·zip은 만들지 않고 복사하지 않는다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedExecutable } from './lib/packagedApp.mjs';

if (process.platform !== 'darwin') {
  console.error('package:mac은 macOS에서만 실행할 수 있습니다(결정 M2-3)');
  process.exit(1);
}

const desktop = fileURLToPath(new URL('../desktop/', import.meta.url));
const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const BUILD_DIR = join(tmpdir(), 'btterm-release');

function run(command, args) {
  execFileSync(command, args, { cwd: desktop, stdio: 'inherit' });
}

rmSync(BUILD_DIR, { recursive: true, force: true });
run('pnpm', ['exec', 'electron-vite', 'build']);
run('pnpm', [
  'exec',
  'electron-builder',
  '--mac',
  'dmg',
  '--universal',
  '--publish',
  'never',
  `--config.directories.output=${BUILD_DIR}`,
]);

const target = join(desktop, 'release', version);
mkdirSync(target, { recursive: true });
const sums = [];
for (const name of readdirSync(BUILD_DIR)) {
  if (!name.endsWith('.dmg')) continue;
  copyFileSync(join(BUILD_DIR, name), join(target, name));
  const hash = createHash('sha256')
    .update(readFileSync(join(BUILD_DIR, name)))
    .digest('hex');
  sums.push(`${hash}  ${name}`);
}
writeFileSync(join(target, 'SHA256SUMS-mac.txt'), `${sums.join('\n')}\n`);
console.log(`package: ${target}`);
console.log(`package: 압축 해제본 ${packagedExecutable(BUILD_DIR, 'darwin')}`);
