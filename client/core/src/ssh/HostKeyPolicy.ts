import { encodeBase64 } from '../encoding/base64';
import { lookupName, matchesHost, type HmacSha1, type KnownHostsEntry } from './knownHosts';

export interface HostKey {
  keyType: string;
  key: string;
}

export type HostKeyVerdict =
  | { verdict: 'trusted' }
  | { verdict: 'unknown' }
  | { verdict: 'mismatch'; known: HostKey[] }
  | { verdict: 'revoked' };

/**
 * 서버가 제시한 호스트 키를 known_hosts 항목과 대조한다(F2.3).
 * 같은 타입의 키가 다르면 mismatch(차단 대상), 다른 타입만 있으면 새 키로 보고 unknown.
 */
export function evaluateHostKey(
  entries: KnownHostsEntry[],
  host: string,
  port: number,
  presented: HostKey,
  hmac: HmacSha1,
): HostKeyVerdict {
  const name = lookupName(host, port);
  const sameKey = (e: KnownHostsEntry) =>
    e.keyType === presented.keyType && e.key === presented.key;

  if (entries.some((e) => e.marker === 'revoked' && sameKey(e))) return { verdict: 'revoked' };

  const candidates = entries.filter((e) => e.marker === null && matchesHost(e, name, hmac));
  if (candidates.some(sameKey)) return { verdict: 'trusted' };

  const sameType = candidates.filter((e) => e.keyType === presented.keyType);
  if (sameType.length > 0) {
    return {
      verdict: 'mismatch',
      known: sameType.map((e) => ({ keyType: e.keyType, key: e.key })),
    };
  }
  return { verdict: 'unknown' };
}

/** OpenSSH 표기 지문: "SHA256:" + 패딩 없는 base64. 다이제스트 계산은 어댑터가 한다. */
export function formatFingerprint(sha256Digest: Uint8Array): string {
  return `SHA256:${encodeBase64(sha256Digest, { padding: false })}`;
}
