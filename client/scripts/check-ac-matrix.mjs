// AGENTS.md §6: 테스트 이름에 AC 번호를 넣고, docs/qa/ac-matrix.md와 대조한다.
// 매트릭스에서 상태가 "done"인 AC는 반드시 테스트 이름에 등장해야 한다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const matrixPath = join(root, 'docs', 'qa', 'ac-matrix.md');

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(test|e2e)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const testFiles = ['client']
  .map((d) => join(root, d))
  .flatMap((d) => {
    try {
      return walk(d, []);
    } catch {
      return [];
    }
  });

const covered = new Set();
for (const file of testFiles) {
  for (const m of readFileSync(file, 'utf8').matchAll(/\bAC\d+[a-z]?\b/g)) covered.add(m[0]);
}

const rows = readFileSync(matrixPath, 'utf8')
  .split('\n')
  .filter((l) => /^\|\s*AC\d+/.test(l))
  .map((l) => l.split('|').map((c) => c.trim()));

const missing = rows.filter((r) => r[4] === 'done' && !covered.has(r[1])).map((r) => r[1]);

if (missing.length > 0) {
  console.error(`ac-matrix: done으로 표시됐지만 테스트 이름에 없는 AC: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(
  `ac-matrix: ${rows.filter((r) => r[4] === 'done').length}개 done, 테스트 참조 ${covered.size}개 확인`,
);
