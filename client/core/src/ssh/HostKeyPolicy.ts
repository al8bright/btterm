import { encodeBase64 } from '../encoding/base64';
import { lookupName, matchesHost, type HmacSha1, type KnownHostsEntry } from './knownHosts';

export interface HostKey {
  keyType: string;
  key: string;
}

/**
 * 차단 사유. key-changed: 같은 종류의 저장된 키와 다르다.
 * other-type-known: 이 호스트에 다른 종류의 키만 저장돼 있다(종류를 바꿔 내민 MITM일 수 있다).
 */
export type HostKeyMismatchReason = 'key-changed' | 'other-type-known';

export type HostKeyVerdict =
  | { verdict: 'trusted' }
  | { verdict: 'unknown' }
  | { verdict: 'mismatch'; reason: HostKeyMismatchReason; known: HostKey[] }
  | { verdict: 'revoked' };

/**
 * 서버가 제시한 호스트 키를 known_hosts 항목과 대조한다(F2.3, SEC-3).
 * 그 호스트에 저장된 키가 하나라도 있는데 제시된 키와 일치하는 것이 없으면 차단(mismatch)이다. 다른 종류의 키만
 * 알려진 경우 OpenSSH는 확인창으로 묻지만 btterm은 더 엄격하게 차단한다(PRD F2.3).
 * 저장된 키가 전혀 없을 때만 unknown(사용자 확인).
 */
export function evaluateHostKey(
  entries: KnownHostsEntry[],
  host: string,
  port: number,
  presented: HostKey,
  hmac: HmacSha1,
): HostKeyVerdict {
  const sameKey = (e: KnownHostsEntry) =>
    e.keyType === presented.keyType && e.key === presented.key;

  if (entries.some((e) => e.marker === 'revoked' && sameKey(e))) return { verdict: 'revoked' };

  const candidates = hostEntries(entries, host, port, hmac);
  if (candidates.some(sameKey)) return { verdict: 'trusted' };
  if (candidates.length === 0) return { verdict: 'unknown' };

  const sameType = candidates.filter((e) => e.keyType === presented.keyType);
  return {
    verdict: 'mismatch',
    reason: sameType.length > 0 ? 'key-changed' : 'other-type-known',
    known: (sameType.length > 0 ? sameType : candidates).map((e) => ({
      keyType: e.keyType,
      key: e.key,
    })),
  };
}

/** 이 호스트에 저장된 키 종류(중복 없이, 파일 순서). 연결 때 서버가 이 종류를 먼저 고르게 한다(SEC-3). */
export function knownKeyTypes(
  entries: KnownHostsEntry[],
  host: string,
  port: number,
  hmac: HmacSha1,
): string[] {
  return [...new Set(hostEntries(entries, host, port, hmac).map((e) => e.keyType))];
}

/** 이 호스트와 일치하는 일반 항목(폐기·인증기관 표시 항목 제외) */
function hostEntries(
  entries: KnownHostsEntry[],
  host: string,
  port: number,
  hmac: HmacSha1,
): KnownHostsEntry[] {
  const name = lookupName(host, port);
  return entries.filter((e) => e.marker === null && matchesHost(e, name, hmac));
}

/** OpenSSH 표기 지문: "SHA256:" + 패딩 없는 base64. 다이제스트 계산은 어댑터가 한다. */
export function formatFingerprint(sha256Digest: Uint8Array): string {
  return `SHA256:${encodeBase64(sha256Digest, { padding: false })}`;
}
