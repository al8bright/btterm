import { describe, expect, it } from 'vitest';
import { maskForLog, maskSecretsInText } from './maskForLog';

const M = '[masked]';

describe('maskForLog', () => {
  it('비밀 키 이름의 값을 대소문자 무시하고 가린다', () => {
    expect(
      maskForLog({
        host: 'web-01',
        Password: 'p@ss',
        passphrase: 'x',
        privateKey: '-----BEGIN',
        Authorization: 'Bearer t',
        dek: 'k',
        passwd: 'y',
        cookie: 'c',
        apiToken: 't',
        secretRef: 'r',
      }),
    ).toEqual({
      host: 'web-01',
      Password: M,
      passphrase: M,
      privateKey: M,
      Authorization: M,
      dek: M,
      passwd: M,
      cookie: M,
      apiToken: M,
      secretRef: M,
    });
  });

  it('중첩 객체와 배열도 가린다', () => {
    expect(maskForLog({ list: [{ password: 'a' }], opts: { auth: { token: 'b' } } })).toEqual({
      list: [{ password: M }],
      opts: { auth: { token: M } },
    });
  });

  it('Buffer·Uint8Array 값은 내용을 남기지 않고 길이만 표시한다', () => {
    expect(maskForLog({ data: new Uint8Array([1, 2, 3]) })).toEqual({ data: '[bytes:3]' });
  });

  it('순환 참조가 있어도 멈추지 않는다', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(maskForLog(a)).toEqual({ name: 'a', self: '[circular]' });
  });

  it('원본은 바꾸지 않는다', () => {
    const input = { password: 'a' };
    maskForLog(input);
    expect(input.password).toBe('a');
  });
});

describe('maskSecretsInText', () => {
  it.each([
    ['mysql -u root -psecret123 db', `mysql -u root -p${M} db`],
    ['tool --password=hunter2 x', `tool --password=${M} x`],
    ['tool --password hunter2 x', `tool --password ${M} x`],
    ['export GITHUB_TOKEN=ghp_abc', `export GITHUB_TOKEN=${M}`],
    ['export AWS_SECRET_ACCESS_KEY=abc', `export AWS_SECRET_ACCESS_KEY=${M}`],
    ['git clone https://user:pa55@host/repo', `git clone https://user:${M}@host/repo`],
    ['ls -lh /var/log', 'ls -lh /var/log'],
    ['ssh -p 2222 web-01', 'ssh -p 2222 web-01'],
    ['-psecret', '-p[masked]'],
    ['curl -H "Authorization: Bearer abc.DEF-123"', 'curl -H "Authorization: Bearer [masked]"'],
    ['curl -H "Authorization: Basic dXNlcjpwYXNz"', 'curl -H "Authorization: Basic [masked]"'],
  ])('%s', (input, expected) => {
    expect(maskSecretsInText(input)).toBe(expected);
  });
});

describe('maskForLog __proto__ 키(보안 리뷰 #11)', () => {
  it('__proto__ 키도 사라지지 않고 기록되며 원형을 오염시키지 않는다', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "password": "x"}') as Record<
      string,
      unknown
    >;
    const out = maskForLog(input) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(out.password).toBe('[masked]');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
