import { describe, expect, it } from 'vitest';
import { inspectKey } from './keyInspector';
import { opensshEd25519, pemRsa } from '../../../test/keys';

describe('inspectKey', () => {
  it('F7.3 OpenSSH ed25519 키의 타입·공개키·SHA256 지문을 읽는다', () => {
    const key = opensshEd25519();
    const result = inspectKey(key.privateKey);
    expect(result).toMatchObject({ ok: true, keyType: 'ssh-ed25519', encrypted: false });
    if (!result.ok) throw new Error('unreachable');
    expect(result.publicKey).toBe(key.publicLine.split(' ').slice(0, 2).join(' '));
    expect(result.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it('F7.3 PEM RSA 키를 읽는다', () => {
    expect(inspectKey(pemRsa().privateKey)).toMatchObject({ ok: true, keyType: 'ssh-rsa' });
  });

  it('암호화된 키에 passphrase가 없으면 needs-passphrase', () => {
    expect(inspectKey(opensshEd25519('pw-123').privateKey)).toEqual({
      ok: false,
      reason: 'needs-passphrase',
    });
    expect(inspectKey(pemRsa('pw-123').privateKey)).toEqual({
      ok: false,
      reason: 'needs-passphrase',
    });
  });

  it('암호화된 키는 올바른 passphrase로 열리고 encrypted=true', () => {
    const result = inspectKey(opensshEd25519('pw-123').privateKey, 'pw-123');
    expect(result).toMatchObject({ ok: true, keyType: 'ssh-ed25519', encrypted: true });
  });

  it('passphrase가 틀리면 bad-passphrase', () => {
    expect(inspectKey(opensshEd25519('pw-123').privateKey, 'wrong')).toEqual({
      ok: false,
      reason: 'bad-passphrase',
    });
  });

  it('키 형식이 아니면 invalid', () => {
    expect(inspectKey(new TextEncoder().encode('hello'))).toEqual({ ok: false, reason: 'invalid' });
  });
});
