// pnpm 11 + hoisted 환경에서 electron postinstall이 실행되지 않는 경우가 있어(PRD Q9),
// 설치 후 바이너리가 없으면 electron의 install.js를 직접 실행한다.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(join(process.cwd(), 'desktop', 'package.json'));
let electronDir;
try {
  electronDir = dirname(require.resolve('electron/package.json'));
} catch {
  process.exit(0); // electron 미설치(부분 설치 등)면 할 일 없음
}
const pathFile = join(electronDir, 'path.txt');
if (existsSync(pathFile) && existsSync(join(electronDir, 'dist'))) process.exit(0);

console.log('electron 바이너리가 없어 install.js를 실행합니다');
execFileSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' });
