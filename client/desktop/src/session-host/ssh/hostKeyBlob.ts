import { createHash } from 'node:crypto';
import { formatFingerprint, type PresentedHostKey } from '@btterm/core';

/** 공개키 blob: string(keyType) + ... → known_hosts 형식(keyType, base64)과 SHA256 지문. */
export function describeHostKey(blob: Buffer): PresentedHostKey {
  const typeLength = blob.readUInt32BE(0);
  const keyType = blob.subarray(4, 4 + typeLength).toString('ascii');
  const digest = createHash('sha256').update(blob).digest();
  return { keyType, key: blob.toString('base64'), fingerprint: formatFingerprint(digest) };
}
