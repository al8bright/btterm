/** 호스트 키 서명 알고리즘 → known_hosts에 기록되는 키 종류. RSA 키는 서명 알고리즘이 여럿이다 */
function keyTypeOf(algorithm: string): string {
  return algorithm === 'rsa-sha2-512' || algorithm === 'rsa-sha2-256' ? 'ssh-rsa' : algorithm;
}

/**
 * SEC-3: 이미 알려진 종류의 호스트 키를 서버가 먼저 고르도록 알고리즘 목록을 정렬한다(OpenSSH와 같은 방식).
 * 알려진 키와 종류가 다른 키는 차단하므로, 정상 서버가 다른 종류를 내밀어 오탐으로 막히지 않게 한다.
 * 알려진 종류가 기본 목록에 하나도 없으면 null(엔진 기본값을 그대로 쓴다).
 * 기본 목록 안의 상대 순서는 유지하고, 목록에 없는 알고리즘은 더하지 않는다.
 */
export function preferKnownHostKeyAlgorithms(
  defaults: readonly string[],
  knownKeyTypes: readonly string[],
): string[] | null {
  const known = new Set(knownKeyTypes);
  const preferred = defaults.filter((algorithm) => known.has(keyTypeOf(algorithm)));
  if (preferred.length === 0) return null;
  return [...preferred, ...defaults.filter((algorithm) => !preferred.includes(algorithm))];
}
