import type { HmacSha1 } from '../ssh/knownHosts';
import { encodeBase64 } from '../encoding/base64';

/**
 * 테스트용 결정적 "HMAC". 실제 HMAC-SHA1이 아니라 key와 data를 XOR로 섞은 20바이트다.
 * 해시 항목 매칭 로직만 검증하고, 실제 알고리즘은 desktop 어댑터의 통합 테스트가 맡는다.
 */
export const fakeHmacSha1: HmacSha1 = (key, data) => {
  const out = new Uint8Array(20);
  for (let i = 0; i < data.length; i++) out[i % 20]! ^= data[i]!;
  for (let i = 0; i < key.length; i++) out[(i + 7) % 20]! ^= key[i]!;
  return out;
};

export function hashedHostEntry(name: string, salt = new Uint8Array([1, 2, 3, 4])): string {
  const hash = fakeHmacSha1(salt, new TextEncoder().encode(name));
  return `|1|${encodeBase64(salt)}|${encodeBase64(hash)}`;
}
