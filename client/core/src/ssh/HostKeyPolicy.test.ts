import { describe, expect, it } from 'vitest';
import { evaluateHostKey, formatFingerprint, knownKeyTypes } from './HostKeyPolicy';
import { parseKnownHosts } from './knownHosts';
import { fakeHmacSha1, hashedHostEntry } from '../testing/fakeCrypto';

const store = (text: string) => parseKnownHosts(text);
const ed = (key: string) => ({ keyType: 'ssh-ed25519', key });

describe('evaluateHostKey', () => {
  it('AC9 저장된 키가 없으면 unknown', () => {
    expect(evaluateHostKey([], 'web-01', 22, ed('AAAA1'), fakeHmacSha1)).toEqual({
      verdict: 'unknown',
    });
  });

  it('같은 타입·같은 키가 저장돼 있으면 trusted', () => {
    const entries = store('web-01 ssh-ed25519 AAAA1\n');
    expect(evaluateHostKey(entries, 'web-01', 22, ed('AAAA1'), fakeHmacSha1).verdict).toBe(
      'trusted',
    );
  });

  it('AC10 같은 타입인데 키가 다르면 mismatch이고 저장된 키를 알려준다', () => {
    const entries = store('web-01 ssh-ed25519 AAAA1\n');
    const result = evaluateHostKey(entries, 'web-01', 22, ed('AAAA2'), fakeHmacSha1);
    expect(result).toEqual({
      verdict: 'mismatch',
      reason: 'key-changed',
      known: [{ keyType: 'ssh-ed25519', key: 'AAAA1' }],
    });
  });

  it('SEC-3 AC10 저장된 키가 다른 종류뿐이면(종류 다운그레이드) 차단 대상 mismatch', () => {
    const entries = store('web-01 ssh-ed25519 AAAA1\nweb-01 ecdsa-sha2-nistp256 AAAAEC\n');
    const rsa = { keyType: 'ssh-rsa', key: 'AAAARSA' };
    expect(evaluateHostKey(entries, 'web-01', 22, rsa, fakeHmacSha1)).toEqual({
      verdict: 'mismatch',
      reason: 'other-type-known',
      known: [
        { keyType: 'ssh-ed25519', key: 'AAAA1' },
        { keyType: 'ecdsa-sha2-nistp256', key: 'AAAAEC' },
      ],
    });
  });

  it('SEC-3 같은 종류가 저장돼 있으면 다른 종류가 함께 있어도 key-changed로 그 종류만 알려준다', () => {
    const entries = store('web-01 ssh-rsa AAAARSA\nweb-01 ssh-ed25519 AAAA1\n');
    expect(evaluateHostKey(entries, 'web-01', 22, ed('AAAA2'), fakeHmacSha1)).toEqual({
      verdict: 'mismatch',
      reason: 'key-changed',
      known: [{ keyType: 'ssh-ed25519', key: 'AAAA1' }],
    });
  });

  it('SEC-3 여러 종류가 저장된 호스트는 그중 하나와 일치하면 trusted', () => {
    const entries = store('web-01 ssh-ed25519 AAAA1\nweb-01 ssh-rsa AAAARSA\n');
    const rsa = { keyType: 'ssh-rsa', key: 'AAAARSA' };
    expect(evaluateHostKey(entries, 'web-01', 22, rsa, fakeHmacSha1).verdict).toBe('trusted');
  });

  it('SEC-3 다른 호스트에만 저장된 키는 이 호스트의 판정에 쓰지 않는다', () => {
    const entries = store('db-01 ssh-rsa AAAARSA\n');
    expect(evaluateHostKey(entries, 'web-01', 22, ed('AAAA1'), fakeHmacSha1).verdict).toBe(
      'unknown',
    );
  });

  it('SEC-3 호스트 이름은 대소문자를 가리지 않는다(평문·해시 항목, [host]:port)', () => {
    const plain = store('web-01 ssh-ed25519 AAAA1\n');
    expect(evaluateHostKey(plain, 'WEB-01', 22, ed('AAAA1'), fakeHmacSha1).verdict).toBe('trusted');
    const hashed = store(`${hashedHostEntry('[web-01.corp]:2222')} ssh-ed25519 AAAA1\n`);
    expect(evaluateHostKey(hashed, 'Web-01.Corp', 2222, ed('AAAA1'), fakeHmacSha1).verdict).toBe(
      'trusted',
    );
    expect(evaluateHostKey(hashed, 'Web-01.Corp', 2222, ed('AAAA2'), fakeHmacSha1)).toMatchObject({
      verdict: 'mismatch',
      reason: 'key-changed',
    });
  });

  it('@revoked 키는 항상 revoked', () => {
    const entries = store('@revoked * ssh-ed25519 AAAABAD\nweb-01 ssh-ed25519 AAAABAD\n');
    expect(evaluateHostKey(entries, 'web-01', 22, ed('AAAABAD'), fakeHmacSha1).verdict).toBe(
      'revoked',
    );
  });

  it('포트가 22가 아니면 [host]:port 항목만 본다', () => {
    const entries = store('web-01 ssh-ed25519 AAAA1\n');
    expect(evaluateHostKey(entries, 'web-01', 2222, ed('AAAA9'), fakeHmacSha1).verdict).toBe(
      'unknown',
    );
  });

  it('@cert-authority 항목은 호스트 키 비교에 쓰지 않는다', () => {
    const entries = store('@cert-authority web-01 ssh-ed25519 AAAACA\n');
    expect(evaluateHostKey(entries, 'web-01', 22, ed('AAAA1'), fakeHmacSha1).verdict).toBe(
      'unknown',
    );
  });
});

describe('knownKeyTypes', () => {
  it('SEC-3 이 호스트에 저장된 키 종류를 중복 없이 돌려준다(폐기·인증기관 항목 제외)', () => {
    const entries = store(
      [
        'web-01 ssh-ed25519 AAAA1',
        '[web-01]:2222 ecdsa-sha2-nistp256 AAAAEC',
        `${hashedHostEntry('web-01')} ssh-rsa AAAARSA`,
        'web-0? ssh-ed25519 AAAA9',
        '@revoked web-01 ecdsa-sha2-nistp384 AAAABAD',
        '@cert-authority web-01 ssh-ed25519 AAAACA',
        'db-01 ecdsa-sha2-nistp521 AAAADB',
      ].join('\n'),
    );
    expect(knownKeyTypes(entries, 'WEB-01', 22, fakeHmacSha1)).toEqual(['ssh-ed25519', 'ssh-rsa']);
    expect(knownKeyTypes(entries, 'web-01', 2222, fakeHmacSha1)).toEqual(['ecdsa-sha2-nistp256']);
    expect(knownKeyTypes(entries, 'new-host', 22, fakeHmacSha1)).toEqual([]);
  });
});

describe('formatFingerprint', () => {
  it('SHA256: 접두사 + 패딩 없는 base64', () => {
    expect(formatFingerprint(new Uint8Array([0xff, 0xee, 0xdd, 0xcc]))).toBe('SHA256:/+7dzA');
  });
});
