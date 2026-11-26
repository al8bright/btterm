// 통합·E2E 테스트 전역 준비. Docker가 없으면 skip하지 않고 원인과 함께 실패한다(AGENTS.md §6).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 현재 폴더에서 위로 올라가며 desktop/test/sshd/compose.yml 을 찾는다(ESM·CJS 어디서 불러도 동작). */
function findComposeFile(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = join(dir, 'desktop', 'test', 'sshd', 'compose.yml');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('desktop/test/sshd/compose.yml 을 찾을 수 없습니다');
  }
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function setup(): Promise<void> {
  try {
    docker(['info', '--format', '{{.OSType}}']);
  } catch (error) {
    throw new Error(
      '통합 테스트에는 Docker(Linux 컨테이너)가 필요합니다. Docker Desktop을 실행하세요.',
      { cause: error },
    );
  }
  docker(['compose', '-f', findComposeFile(), 'up', '-d', '--wait']);
}

export async function teardown(): Promise<void> {
  if (process.env.BTTERM_KEEP_SSHD === '1') return;
  docker(['compose', '-f', findComposeFile(), 'down', '-v']);
}
