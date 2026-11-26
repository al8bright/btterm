import { describe, expect, it } from 'vitest';
import { generateKey } from './keyGenerator';
import { inspectKey } from './keyInspector';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('generateKey (F7.7, 결정 TR4)', () => {
  it('ed25519 키를 OpenSSH 형식으로 만든다', async () => {
    const key = await generateKey({ keyType: 'ed25519', comment: 'btterm' });
    expect(key.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(inspectKey(bytes(key.privateKey))).toMatchObject({
      ok: true,
      keyType: 'ssh-ed25519',
      encrypted: false,
    });
  });

  it('passphrase를 주면 암호화하고, 그 passphrase로만 열린다', async () => {
    const key = await generateKey({ keyType: 'ed25519', passphrase: 'pw-123', comment: '' });
    expect(inspectKey(bytes(key.privateKey))).toEqual({ ok: false, reason: 'needs-passphrase' });
    expect(inspectKey(bytes(key.privateKey), 'pw-123')).toMatchObject({
      ok: true,
      encrypted: true,
    });
  });

  it('RSA는 4096비트로 만든다', async () => {
    const key = await generateKey({ keyType: 'rsa', comment: '' });
    expect(inspectKey(bytes(key.privateKey))).toMatchObject({ ok: true, keyType: 'ssh-rsa' });
    // 4096비트 공개키 blob은 base64로 700자 남짓이다(2048비트는 370자 남짓)
    expect(key.publicKey.split(' ')[1]!.length).toBeGreaterThan(700);
  }, 30_000);
});
