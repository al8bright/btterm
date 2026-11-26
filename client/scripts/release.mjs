// 로컬 릴리스(0.x semver). 원격 push·배포는 하지 않는다(AGENTS §2: push는 요청할 때만).
// 사용: pnpm release [patch|minor] [--skip-smoke] [--dry-run]
//  --dry-run: 검증·패키징·Fuses·스모크만 하고 버전·커밋·태그는 바꾸지 않는다.
//  1. main 브랜치·깨끗한 작업 트리 확인  2. pnpm verify
//  3. 버전 올리기  4. 패키징  5. Fuses 확인  6. 패키징 앱 스모크(Docker sshd)
//  7. 릴리스 노트(지난 태그 이후 커밋)  8. 버전 커밋 + 로컬 태그
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const level = process.argv.find((a) => a === 'patch' || a === 'minor') ?? 'patch';
const skipSmoke = process.argv.includes('--skip-smoke');
const dryRun = process.argv.includes('--dry-run');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

if (git('branch', '--show-current') !== 'main') throw new Error('release: main 브랜치에서만');
if (!dryRun && git('status', '--porcelain') !== '') {
  throw new Error('release: 커밋하지 않은 변경이 있습니다');
}

run('pnpm', ['verify']);

const pkgPath = join(root, 'desktop', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
if (major !== 0) throw new Error('release: 0.x 동안만 이 스크립트를 쓴다');
const next = level === 'minor' ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`;
if (!dryRun) {
  pkg.version = next;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

run('node', ['scripts/package-win.mjs']);
run('node', ['scripts/check-fuses.mjs']);
if (!skipSmoke) run('node', ['scripts/smoke-packaged.mjs']);

if (dryRun) {
  console.log(`release: dry-run 통과(다음 버전 ${next} 예정, 변경 없음)`);
  process.exit(0);
}

function previousTag() {
  try {
    return git('describe', '--tags', '--abbrev=0');
  } catch {
    return '';
  }
}
const lastTag = previousTag();
const log = git('log', '--pretty=- %s', ...(lastTag ? [`${lastTag}..HEAD`] : []));
const notes = `# btterm ${next}\n\n${log}\n`;
writeFileSync(join(root, 'desktop', 'release', next, 'NOTES.md'), notes);

git('add', pkgPath);
git(
  'commit',
  '-m',
  `[Behavioral] chore: ${next} 릴리스\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`,
);
git('tag', '-a', `v${next}`, '-m', `btterm ${next}`);
console.log(`release: v${next} 태그 생성(로컬). push는 하지 않았습니다.`);
