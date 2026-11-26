import { describe, expect, it } from 'vitest';
import { evaluateHostKey, formatFingerprint } from './HostKeyPolicy';
import { parseKnownHosts } from './knownHosts';
import { fakeHmacSha1 } from '../testing/fakeCrypto';

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
      known: [{ keyType: 'ssh-ed25519', key: 'AAAA1' }],
    });
  });

  it('저장된 키가 다른 타입뿐이면 새 키로 보고 unknown', () => {
    const entries = store('web-01 ssh-rsa AAAARSA\n');
    expect(evaluateHostKey(entries, 'web-01', 22, ed('AAAA1'), fakeHmacSha1).verdict).toBe(
      'unknown',
    );
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

describe('formatFingerprint', () => {
  it('SHA256: 접두사 + 패딩 없는 base64', () => {
    expect(formatFingerprint(new Uint8Array([0xff, 0xee, 0xdd, 0xcc]))).toBe('SHA256:/+7dzA');
  });
});
