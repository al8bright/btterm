import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SSH2_DEFAULT_SERVER_HOST_KEY, serverHostKeyAlgorithms } from './Ssh2Transport';

const require = createRequire(import.meta.url);

describe('Ssh2Transport 호스트 키 알고리즘 순서 (SEC-3)', () => {
  it('SEC-3 기준 목록은 이 런타임의 ssh2 기본값을 그대로 쓴다(하드코딩하지 않는다)', () => {
    const constants = require('ssh2/lib/protocol/constants.js') as {
      DEFAULT_SERVER_HOST_KEY: string[];
    };
    expect([...SSH2_DEFAULT_SERVER_HOST_KEY]).toEqual(constants.DEFAULT_SERVER_HOST_KEY);
    expect(SSH2_DEFAULT_SERVER_HOST_KEY).toContain('rsa-sha2-512');
  });

  it('SEC-3 알려진 키가 없으면 ssh2 기본값을 그대로 쓴다(설정하지 않는다)', () => {
    expect(serverHostKeyAlgorithms(undefined)).toBeUndefined();
    expect(serverHostKeyAlgorithms([])).toBeUndefined();
    expect(serverHostKeyAlgorithms(['ssh-dss'])).toBeUndefined();
  });

  it('SEC-3 AC10 알려진 종류를 앞에 둔 전체 목록을 넘긴다(다른 종류도 뒤에 남는다)', () => {
    expect(serverHostKeyAlgorithms(['ssh-rsa'])).toEqual([
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
      'ssh-ed25519',
      'ecdsa-sha2-nistp256',
      'ecdsa-sha2-nistp384',
      'ecdsa-sha2-nistp521',
    ]);
  });
});
