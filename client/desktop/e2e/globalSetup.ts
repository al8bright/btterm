import { setup, teardown } from '../test/integration/globalSetup';

// E2E도 통합 테스트와 같은 Docker sshd를 쓴다. Docker가 없으면 실패한다(AGENTS §6).
export default async function globalSetup(): Promise<() => Promise<void>> {
  await setup();
  return teardown;
}
