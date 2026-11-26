// toxiproxy 제어(test/sshd/compose.yml의 toxiproxy 서비스). 네트워크 단절을 재현한다(AC12).
const API = 'http://127.0.0.1:8474';

export const SSH_PROXY = { name: 'ssh', host: '127.0.0.1', port: 2223 } as const;

async function call(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${API}${path}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`toxiproxy ${method} ${path}: ${response.status} ${await response.text()}`);
  }
}

/** sshd 앞에 깨끗한 프록시를 만든다(이전 장애 제거). */
export async function resetSshProxy(): Promise<void> {
  await call('DELETE', `/proxies/${SSH_PROXY.name}`);
  await call('POST', '/proxies', {
    name: SSH_PROXY.name,
    listen: `0.0.0.0:${SSH_PROXY.port}`,
    upstream: 'target:2222',
  });
}

/** 데이터를 모두 삼키고 연결은 닫지 않는다(FIN·RST 없는 단절). */
export async function blackhole(): Promise<void> {
  await call('POST', `/proxies/${SSH_PROXY.name}/toxics`, {
    name: 'blackhole',
    type: 'timeout',
    stream: 'downstream',
    attributes: { timeout: 0 },
  });
}
