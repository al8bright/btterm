// git이 추적하는(또는 추적 예정인) 파일만 secretlint로 검사한다.
// "**/*" 글롭은 hoisted node_modules·Electron 배포물까지 펼쳐 매우 느리다.
// Windows 명령줄 길이 제한(cmd 8191자)을 피하려고 셸 없이 node로 직접, 작은 묶음으로 실행한다.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 앱·서버·문서 모두 검사한다(저장소 루트 기준)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const secretlintBin = fileURLToPath(
  new URL('../node_modules/secretlint/bin/secretlint.js', import.meta.url),
);

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter((f) => f && !f.endsWith('pnpm-lock.yaml'));

const CHUNK = 80;
for (let i = 0; i < files.length; i += CHUNK) {
  execFileSync(
    process.execPath,
    [
      secretlintBin,
      '--secretlintrc',
      'client/.secretlintrc.json',
      '--secretlintignore',
      'client/.secretlintignore',
      ...files.slice(i, i + CHUNK),
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
}
console.log(`secrets: 추적 파일 ${files.length}개 검사, 비밀 없음`);
