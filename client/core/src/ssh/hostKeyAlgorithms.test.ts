import { describe, expect, it } from 'vitest';
import { preferKnownHostKeyAlgorithms } from './hostKeyAlgorithms';

const DEFAULTS = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa',
];

describe('preferKnownHostKeyAlgorithms', () => {
  it('SEC-3 알려진 키가 없으면 null(엔진 기본값을 그대로 쓴다)', () => {
    expect(preferKnownHostKeyAlgorithms(DEFAULTS, [])).toBeNull();
  });

  it('SEC-3 알려진 종류의 알고리즘을 기본 순서대로 앞에 두고 나머지는 뒤에 둔다', () => {
    expect(preferKnownHostKeyAlgorithms(DEFAULTS, ['ecdsa-sha2-nistp256'])).toEqual([
      'ecdsa-sha2-nistp256',
      'ssh-ed25519',
      'ecdsa-sha2-nistp384',
      'ecdsa-sha2-nistp521',
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
    ]);
  });

  it('SEC-3 known_hosts의 ssh-rsa는 rsa-sha2-512·rsa-sha2-256·ssh-rsa 서명 알고리즘 모두에 해당한다', () => {
    expect(preferKnownHostKeyAlgorithms(DEFAULTS, ['ssh-rsa', 'ssh-ed25519'])).toEqual([
      'ssh-ed25519',
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
      'ecdsa-sha2-nistp256',
      'ecdsa-sha2-nistp384',
      'ecdsa-sha2-nistp521',
    ]);
  });

  it('SEC-3 엔진이 모르는 종류(인증서·sk 키 등)만 알려져 있으면 null', () => {
    expect(
      preferKnownHostKeyAlgorithms(DEFAULTS, [
        'ssh-ed25519-cert-v01@openssh.com',
        'sk-ssh-ed25519@openssh.com',
      ]),
    ).toBeNull();
  });
});
