import type { HostKeyVerdict, Prompt } from '@btterm/core';
import { safeFingerprint } from './KnownHostsStore';

interface PresentedKey {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
}

/**
 * 호스트 키 확인·차단 창(F2.3, SEC-3). mismatch면 사유와 저장된 키 지문을,
 * 다른 종류만 알려진 호스트(other-type-known)면 그 종류도 함께 보낸다.
 */
export function hostKeyPrompt(
  presented: PresentedKey,
  result: Extract<HostKeyVerdict, { verdict: 'unknown' | 'mismatch' }>,
): Extract<Prompt, { kind: 'hostKey' }> {
  const base = {
    kind: 'hostKey' as const,
    verdict: result.verdict,
    host: presented.host,
    port: presented.port,
    keyType: presented.keyType,
    fingerprint: presented.fingerprint,
  };
  if (result.verdict === 'unknown') return base;
  const known = result.known.slice(0, MAX_KNOWN);
  return {
    ...base,
    mismatchReason: result.reason,
    knownFingerprints: known.map((k) => safeFingerprint(k.key)),
    ...(result.reason === 'other-type-known'
      ? { knownKeyTypes: [...new Set(known.map((k) => k.keyType.slice(0, 64)))] }
      : {}),
  };
}

/** 경계 스키마 상한 */
const MAX_KNOWN = 32;
