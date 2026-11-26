// commit-msg 훅: 제목 형식 `[Structural|Behavioral] <type>: <요약 50자 이내>` (AGENTS.md §2).
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const subject = readFileSync(file, 'utf8').split(/\r?\n/)[0] ?? '';

if (/^(Merge|Revert) /.test(subject)) process.exit(0);

const match = /^\[(Structural|Behavioral)\] (feat|fix|refactor|docs|style|test|chore): (.+)$/.exec(
  subject,
);
if (!match) {
  console.error(
    `커밋 제목 형식 오류: "${subject}"\n형식: [Structural|Behavioral] <feat|fix|refactor|docs|style|test|chore>: <요약>`,
  );
  process.exit(1);
}
const summary = match[3];
if ([...summary].length > 50) {
  console.error(`요약은 50자 이내여야 합니다(현재 ${[...summary].length}자): ${summary}`);
  process.exit(1);
}
