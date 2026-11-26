// 테스트 전용 SSH 키 생성기. 저장소에 개인키를 두지 않기 위해 실행할 때마다 만든다.
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestKey {
  privateKey: Uint8Array;
  publicLine: string; // authorized_keys 형식
}

/** ssh-keygen으로 OpenSSH 형식 ed25519 키를 만든다(passphrase 선택). */
export function opensshEd25519(passphrase = ''): TestKey {
  const dir = mkdtempSync(join(tmpdir(), 'btterm-key-'));
  try {
    const file = join(dir, 'id');
    execFileSync(
      'ssh-keygen',
      ['-q', '-t', 'ed25519', '-N', passphrase, '-C', 'btterm-test', '-f', file],
      {
        stdio: 'ignore',
      },
    );
    return {
      privateKey: new Uint8Array(readFileSync(file)),
      publicLine: readFileSync(`${file}.pub`, 'utf8').trim(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Node crypto로 PKCS#1 PEM RSA 키를 만든다(passphrase가 있으면 AES-256-CBC 암호화). */
export function pemRsa(passphrase?: string): { privateKey: Uint8Array } {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: passphrase
      ? { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase }
      : { type: 'pkcs1', format: 'pem' },
  });
  return { privateKey: new TextEncoder().encode(privateKey) };
}
