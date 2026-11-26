import { decodeBase64, encodeBase64 } from '../encoding/base64';

/** HMAC-SHA1 포트. core는 crypto를 쓰지 않으므로 desktop 어댑터가 주입한다. */
export type HmacSha1 = (key: Uint8Array, data: Uint8Array) => Uint8Array;

export type KnownHostsMarker = 'cert-authority' | 'revoked';

export type KnownHostsHosts =
  { kind: 'patterns'; patterns: string[] } | { kind: 'hashed'; salt: string; hash: string };

export interface KnownHostsEntry {
  marker: KnownHostsMarker | null;
  hosts: KnownHostsHosts;
  keyType: string;
  key: string;
  comment: string | null;
  line: number;
}

const MARKERS: Record<string, KnownHostsMarker> = {
  '@cert-authority': 'cert-authority',
  '@revoked': 'revoked',
};

/** OpenSSH known_hosts 텍스트를 항목으로 읽는다. 형식이 맞지 않는 줄은 버린다. */
export function parseKnownHosts(text: string): KnownHostsEntry[] {
  const entries: KnownHostsEntry[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const entry = parseLine(raw.trim(), index + 1);
    if (entry) entries.push(entry);
  });
  return entries;
}

function parseLine(line: string, lineNo: number): KnownHostsEntry | null {
  if (line === '' || line.startsWith('#')) return null;
  const fields = line.split(/\s+/);
  const marker = fields[0] !== undefined ? (MARKERS[fields[0]] ?? null) : null;
  const [hostField, keyType, key, ...rest] = marker ? fields.slice(1) : fields;
  if (!hostField || !keyType || !key) return null;
  return {
    marker,
    hosts: parseHosts(hostField),
    keyType,
    key,
    comment: rest.length > 0 ? rest.join(' ') : null,
    line: lineNo,
  };
}

function parseHosts(field: string): KnownHostsHosts {
  const hashed = /^\|1\|([^|]+)\|([^|]+)$/.exec(field);
  if (hashed) return { kind: 'hashed', salt: hashed[1]!, hash: hashed[2]! };
  return { kind: 'patterns', patterns: field.split(',') };
}

/**
 * known_hosts에서 한 줄을 지운다(F2.4b). 목록을 본 뒤 파일이 바뀌었으면 엉뚱한 줄을 지우지 않도록
 * 그 줄의 형식·키가 같을 때만 지운다.
 */
export function removeKnownHostLine(
  text: string,
  line: number,
  keyType: string,
  key: string,
): { text: string; removed: boolean } {
  const lines = text.split('\n');
  const entry = parseLine((lines[line - 1] ?? '').trim(), line);
  if (!entry || entry.keyType !== keyType || entry.key !== key) return { text, removed: false };
  lines.splice(line - 1, 1);
  return { text: lines.join('\n'), removed: true };
}

/**
 * known_hosts에서 찾는 이름. 포트 22가 아니면 [host]:port 형식이다.
 * OpenSSH처럼 소문자로 바꾼다: 해시 항목(|1|)은 소문자 이름으로 만들어지므로 대문자가 섞인
 * 이름으로 찾으면 저장된 키를 못 찾아 "처음 보는 호스트"로 보인다(SEC-3).
 */
export function lookupName(host: string, port: number): string {
  const name = host.toLowerCase();
  return port === 22 ? name : `[${name}]:${port}`;
}

export function matchesHost(entry: KnownHostsEntry, name: string, hmac: HmacSha1): boolean {
  if (entry.hosts.kind === 'hashed') {
    const digest = hmac(decodeBase64(entry.hosts.salt), new TextEncoder().encode(name));
    return encodeBase64(digest) === entry.hosts.hash;
  }
  let matched = false;
  for (const pattern of entry.hosts.patterns) {
    const negated = pattern.startsWith('!');
    if (!globMatch(negated ? pattern.slice(1) : pattern, name)) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

function globMatch(pattern: string, name: string): boolean {
  const source = pattern
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`, 'i').test(name);
}
