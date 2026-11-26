// SEC-4: 로그·IPC 기록용 마스킹. 키 이름과 값 패턴 두 가지로 가린다. 패턴 원천은 이 파일 하나다.

const MASK = '[masked]';

const SECRET_KEY = /pass(word|wd|phrase)?|private_?key|token|secret|authorization|cookie|^dek$/i;

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  // mysql -psecret (붙여 쓴 -p 값만. "-p 2222" 같은 포트 인자는 건드리지 않는다)
  [/((?:^|\s)-p)(?!\s)(\S+)/g, `$1${MASK}`],
  // --password=x, --password x
  [/(--pass(?:word)?[= ])(\S+)/gi, `$1${MASK}`],
  // FOO_TOKEN=x, AWS_SECRET_ACCESS_KEY=x
  [
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY)[A-Z0-9_]*=)(\S+)/g,
    `$1${MASK}`,
  ],
  // Authorization: Bearer x / Basic x
  [/(\b(?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]+)/gi, `$1${MASK}`],
  // https://user:pass@host
  [/(:\/\/[^/\s:@]+:)([^@\s/]+)(@)/g, `$1${MASK}$3`],
];

/** 명령줄·오류 메시지 같은 텍스트 안의 비밀 값을 가린다. */
export function maskSecretsInText(text: string): string {
  return TEXT_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

/** 객체를 로그에 남기기 전에 비밀 키 값과 텍스트 속 비밀을 가린 사본을 만든다. */
export function maskForLog(value: unknown): unknown {
  return walk(value, new WeakSet());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return maskSecretsInText(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return `[bytes:${value.length}]`;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, seen));
  // __proto__ 같은 키도 일반 속성으로 담는다(대입하면 원형이 바뀌거나 값이 사라진다).
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(out, key, {
      value: SECRET_KEY.test(key) ? MASK : walk(item, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
