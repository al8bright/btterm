import ssh2 from 'ssh2';
import { describeHostKey } from './hostKeyBlob';

export type KeyInspection =
  | { ok: true; keyType: string; publicKey: string; fingerprint: string; encrypted: boolean }
  | { ok: false; reason: 'needs-passphrase' | 'bad-passphrase' | 'invalid' };

const NEEDS_PASSPHRASE = /no passphrase given/i;

/** 개인키 형식·암호화 여부·공개키·지문을 확인한다(F7.3). ssh2를 쓰므로 session host에서만 호출한다. */
export function inspectKey(privateKey: Uint8Array, passphrase?: string): KeyInspection {
  const data = Buffer.from(privateKey);
  const plain = ssh2.utils.parseKey(data);
  const encrypted = plain instanceof Error && NEEDS_PASSPHRASE.test(plain.message);

  const parsed =
    encrypted && passphrase !== undefined ? ssh2.utils.parseKey(data, passphrase) : plain;
  if (parsed instanceof Error) {
    if (!encrypted) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: passphrase === undefined ? 'needs-passphrase' : 'bad-passphrase' };
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!key) return { ok: false, reason: 'invalid' };
  const blob = key.getPublicSSH();
  const described = describeHostKey(blob);
  return {
    ok: true,
    keyType: described.keyType,
    publicKey: `${described.keyType} ${described.key}`,
    fingerprint: described.fingerprint,
    encrypted,
  };
}
