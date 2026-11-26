import { describe, expect, it } from 'vitest';
import { lookupName, matchesHost, parseKnownHosts, removeKnownHostLine } from './knownHosts';
import { fakeHmacSha1, hashedHostEntry } from '../testing/fakeCrypto';

describe('parseKnownHosts', () => {
  it('빈 파일은 항목 0개', () => {
    expect(parseKnownHosts('')).toEqual([]);
  });

  it('주석과 빈 줄을 건너뛴다', () => {
    expect(parseKnownHosts('# comment\n\n   \n')).toEqual([]);
  });

  it('평문 호스트 목록, 키 타입, 키, 주석을 읽는다', () => {
    const [entry] = parseKnownHosts('web-01,10.0.0.5 ssh-ed25519 AAAAKEY user@pc\n');
    expect(entry).toEqual({
      marker: null,
      hosts: { kind: 'patterns', patterns: ['web-01', '10.0.0.5'] },
      keyType: 'ssh-ed25519',
      key: 'AAAAKEY',
      comment: 'user@pc',
      line: 1,
    });
  });

  it('@cert-authority, @revoked 마커를 읽는다', () => {
    const entries = parseKnownHosts(
      '@revoked * ssh-rsa AAAABAD\n@cert-authority *.corp ssh-ed25519 AAAACA\n',
    );
    expect(entries.map((e) => e.marker)).toEqual(['revoked', 'cert-authority']);
  });

  it('해시 항목 |1|salt|hash 를 읽는다', () => {
    const [entry] = parseKnownHosts('|1|c2FsdA==|aGFzaA== ssh-ed25519 AAAAKEY\n');
    expect(entry?.hosts).toEqual({ kind: 'hashed', salt: 'c2FsdA==', hash: 'aGFzaA==' });
  });

  it('필드가 모자란 줄은 무시한다', () => {
    expect(parseKnownHosts('broken-line ssh-ed25519\n')).toEqual([]);
  });
});

describe('lookupName', () => {
  it('포트 22는 호스트 이름 그대로', () => {
    expect(lookupName('web-01', 22)).toBe('web-01');
  });

  it('다른 포트는 [host]:port', () => {
    expect(lookupName('web-01', 2222)).toBe('[web-01]:2222');
  });
});

describe('matchesHost', () => {
  const entry = (hosts: string) => parseKnownHosts(`${hosts} ssh-ed25519 AAAAKEY\n`)[0]!;

  it('정확히 같은 이름과 일치한다', () => {
    expect(matchesHost(entry('web-01'), 'web-01', fakeHmacSha1)).toBe(true);
  });

  it('와일드카드 * 와 ? 를 지원한다', () => {
    expect(matchesHost(entry('*.corp'), 'db.corp', fakeHmacSha1)).toBe(true);
    expect(matchesHost(entry('web-0?'), 'web-07', fakeHmacSha1)).toBe(true);
    expect(matchesHost(entry('web-0?'), 'web-10', fakeHmacSha1)).toBe(false);
  });

  it('부정 패턴 !pattern 이 일치하면 다른 패턴이 일치해도 거부한다', () => {
    expect(matchesHost(entry('*.corp,!secret.corp'), 'secret.corp', fakeHmacSha1)).toBe(false);
    expect(matchesHost(entry('*.corp,!secret.corp'), 'db.corp', fakeHmacSha1)).toBe(true);
  });

  it('[host]:port 형식과 일치한다', () => {
    expect(matchesHost(entry('[web-01]:2222'), '[web-01]:2222', fakeHmacSha1)).toBe(true);
    expect(matchesHost(entry('[web-01]:2222'), 'web-01', fakeHmacSha1)).toBe(false);
  });

  it('해시 항목은 HMAC-SHA1(salt, name)으로 대조한다', () => {
    const hashed = parseKnownHosts(`${hashedHostEntry('web-01')} ssh-ed25519 AAAAKEY\n`)[0]!;
    expect(matchesHost(hashed, 'web-01', fakeHmacSha1)).toBe(true);
    expect(matchesHost(hashed, 'web-02', fakeHmacSha1)).toBe(false);
  });
});

describe('removeKnownHostLine (F2.4b, 결정 TR6)', () => {
  const text = '# 주석\nweb-01 ssh-ed25519 AAAA1\n[db]:2222 ssh-rsa BBBB2\n';

  it('그 줄의 형식·키가 같을 때만 지우고 나머지 줄은 그대로 둔다', () => {
    expect(removeKnownHostLine(text, 2, 'ssh-ed25519', 'AAAA1')).toEqual({
      text: '# 주석\n[db]:2222 ssh-rsa BBBB2\n',
      removed: true,
    });
  });

  it('그사이 파일이 바뀌어 줄이 다르면 지우지 않는다', () => {
    expect(removeKnownHostLine(text, 2, 'ssh-rsa', 'BBBB2')).toEqual({ text, removed: false });
    expect(removeKnownHostLine(text, 9, 'ssh-ed25519', 'AAAA1').removed).toBe(false);
  });
});
