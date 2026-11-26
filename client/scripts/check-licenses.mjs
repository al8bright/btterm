// 배포에 포함되는 의존성(prod)의 라이선스를 검사한다. GPL·AGPL 계열은 사전 승인 없이 쓰지 않는다(AGENTS.md §5).
import { execSync } from 'node:child_process';

const FORBIDDEN = /\b(A?GPL)(?!.*\bOR\b)/i; // "MIT OR GPL" 같은 선택 라이선스는 허용

const raw = execSync('pnpm licenses list --prod --json', { encoding: 'utf8' });
const byLicense = JSON.parse(raw);
const violations = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    count += 1;
    if (FORBIDDEN.test(license) && !/LGPL/i.test(license))
      violations.push(`${pkg.name}@${pkg.versions?.join(',')} (${license})`);
  }
}
if (violations.length > 0) {
  console.error(`금지 라이선스 의존성:\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log(`licenses: prod 의존성 ${count}개 확인, 금지 라이선스 없음`);
