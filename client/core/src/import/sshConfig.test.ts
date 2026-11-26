import { describe, expect, it } from 'vitest';
import { parseSshConfig, type SshConfigFile, type SshConfigHost } from './sshConfig';

const MAIN = '/home/u/.ssh/config';
const noInclude = (): SshConfigFile[] => [];

function parse(text: string, resolve = noInclude): SshConfigHost[] {
  return parseSshConfig([{ path: MAIN, text }], resolve);
}

describe('parseSshConfig 기본', () => {
  it('F1.4 기본 Host 블록을 읽는다', () => {
    const [host] = parse(
      [
        'Host web',
        '  HostName 10.0.0.5',
        '  Port 2222',
        '  User deploy',
        '  IdentityFile ~/.ssh/id_ed25519',
        '  ServerAliveInterval 30',
        '  ProxyJump bastion',
      ].join('\n'),
    );
    expect(host).toEqual({
      alias: 'web',
      hostName: '10.0.0.5',
      port: 2222,
      user: 'deploy',
      identityFiles: ['~/.ssh/id_ed25519'],
      keepaliveSec: 30,
      proxyJump: 'bastion',
      unsupported: {},
      needsApproval: [],
    });
  });

  it('HostName이 없으면 alias를 쓰고 나머지는 null', () => {
    const [host] = parse('Host web\n');
    expect(host).toMatchObject({
      hostName: 'web',
      port: null,
      user: null,
      identityFiles: [],
      keepaliveSec: null,
      proxyJump: null,
    });
  });

  it('빈 입력은 결과 없음', () => {
    expect(parse('')).toEqual([]);
    expect(parseSshConfig([], noInclude)).toEqual([]);
  });

  it('와일드카드만 있는 Host는 결과에 없다', () => {
    expect(parse('Host *\n  User x\nHost *.example.com web-?\n  Port 22\nHost !a\n')).toEqual([]);
  });

  it('alias는 파일에 처음 나온 순서이고 중복은 제거한다', () => {
    const hosts = parse('Host b a\nHost c\nHost a\n');
    expect(hosts.map((h) => h.alias)).toEqual(['b', 'a', 'c']);
  });
});

describe('parseSshConfig 구문', () => {
  it('키워드 대소문자 무시, = 구분자, 따옴표, 주석', () => {
    const [host] = parse(
      [
        '# 주석',
        '',
        'HOST web # 인라인 주석',
        '  hostname=example.com',
        '  PORT = 2200',
        '  User "my user"',
        '  IdentityFile "~/.ssh/my key"',
      ].join('\n'),
    );
    expect(host).toMatchObject({
      alias: 'web',
      hostName: 'example.com',
      port: 2200,
      user: 'my user',
      identityFiles: ['~/.ssh/my key'],
    });
  });

  it('CRLF 줄바꿈을 처리한다', () => {
    const [host] = parse('Host web\r\n  Port 2200\r\n');
    expect(host?.port).toBe(2200);
  });

  it('Host 앞의 전역 지시어는 모든 Host의 기본값이다', () => {
    const [host] = parse('User root\nHost web\n  Port 22\n');
    expect(host?.user).toBe('root');
  });
});

describe('parseSshConfig 첫 값 우선', () => {
  it('Host * 기본값은 뒤에 있으면 구체 블록이 이긴다', () => {
    const [web, db] = parse(
      ['Host web', '  User alice', 'Host db', 'Host *', '  User bob', '  Port 2022'].join('\n'),
    );
    expect(web).toMatchObject({ user: 'alice', port: 2022 });
    expect(db).toMatchObject({ user: 'bob', port: 2022 });
  });

  it('Host * 가 앞에 있으면 앞의 값이 이긴다', () => {
    const [web] = parse(['Host *', '  User bob', 'Host web', '  User alice'].join('\n'));
    expect(web?.user).toBe('bob');
  });

  it('같은 alias의 여러 블록은 없는 키만 채운다', () => {
    const [web] = parse(['Host web', '  Port 1', 'Host web', '  Port 2', '  User u'].join('\n'));
    expect(web).toMatchObject({ port: 1, user: 'u' });
  });

  it('한 Host 줄의 여러 패턴 중 하나라도 맞으면 적용된다', () => {
    const hosts = parse(['Host a b', '  User shared', 'Host c', '  User own'].join('\n'));
    expect(hosts.map((h) => h.user)).toEqual(['shared', 'shared', 'own']);
  });

  it('와일드카드 * ? 패턴이 구체 alias에 적용된다', () => {
    const [prod, other] = parse(
      ['Host prod-1 other', 'Host prod-?', '  User p', 'Host pro*', '  Port 99'].join('\n'),
    );
    expect(prod).toMatchObject({ user: 'p', port: 99 });
    expect(other).toMatchObject({ user: null, port: null });
  });

  it('부정 패턴에 맞으면 블록이 적용되지 않는다', () => {
    const hosts = parse(['Host a b', 'Host * !b', '  User x'].join('\n'));
    expect(hosts.map((h) => h.user)).toEqual(['x', null]);
  });

  it('부정 패턴만 있는 블록은 아무 것도 매칭하지 않는다', () => {
    const [a] = parse(['Host a', 'Host !b', '  User x'].join('\n'));
    expect(a?.user).toBeNull();
  });

  it('IdentityFile은 여러 블록에서 누적하고 중복은 제거한다', () => {
    const [web] = parse(
      [
        'Host web',
        '  IdentityFile ~/.ssh/a',
        '  IdentityFile ~/.ssh/b',
        'Host *',
        '  IdentityFile ~/.ssh/b',
        '  IdentityFile ~/.ssh/c',
      ].join('\n'),
    );
    expect(web?.identityFiles).toEqual(['~/.ssh/a', '~/.ssh/b', '~/.ssh/c']);
  });
});

describe('parseSshConfig 값 검증', () => {
  it.each(['0', '65536', 'abc', '22x', '-1', ''])('잘못된 Port %j는 null', (value) => {
    const [host] = parse(`Host web\n  Port ${value}\n`);
    expect(host?.port).toBeNull();
  });

  it('Port 경계값 1과 65535는 허용', () => {
    expect(parse('Host a\n Port 1\n')[0]?.port).toBe(1);
    expect(parse('Host a\n Port 65535\n')[0]?.port).toBe(65535);
  });

  it('잘못된 첫 Port는 이후 블록 값으로 대체되지 않는다', () => {
    const [host] = parse(['Host web', '  Port abc', 'Host *', '  Port 22'].join('\n'));
    expect(host?.port).toBeNull();
  });

  it('ServerAliveInterval은 숫자만, 아니면 null', () => {
    expect(parse('Host a\n ServerAliveInterval 60\n')[0]?.keepaliveSec).toBe(60);
    expect(parse('Host a\n ServerAliveInterval x\n')[0]?.keepaliveSec).toBeNull();
  });
});

describe('parseSshConfig Include', () => {
  it('Include 파일 내용을 그 위치에 펼친다', () => {
    const calls: Array<[string, string]> = [];
    const hosts = parseSshConfig(
      [{ path: MAIN, text: 'Include conf.d/*\nHost web\n  User main\n' }],
      (pattern, fromPath) => {
        calls.push([pattern, fromPath]);
        return [
          { path: '/home/u/.ssh/conf.d/a', text: 'Host web\n  User included\n  Port 2200\n' },
        ];
      },
    );
    expect(calls).toEqual([['conf.d/*', MAIN]]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ user: 'included', port: 2200 });
  });

  it('여러 파일과 여러 패턴 인자를 모두 펼친다', () => {
    const files: Record<string, SshConfigFile[]> = {
      a: [
        { path: '/x/a1', text: 'Host one\n' },
        { path: '/x/a2', text: 'Host two\n' },
      ],
      b: [{ path: '/x/b', text: 'Host three\n' }],
    };
    const hosts = parseSshConfig([{ path: MAIN, text: 'Include a b\n' }], (p) => files[p] ?? []);
    expect(hosts.map((h) => h.alias)).toEqual(['one', 'two', 'three']);
  });

  it('Include 뒤의 지시어는 포함된 파일 뒤에 놓인다(첫 값 우선)', () => {
    const [web] = parseSshConfig(
      [{ path: MAIN, text: 'Host web\n  Include inc\n  User after\n' }],
      () => [{ path: '/x/inc', text: 'User before\n' }],
    );
    expect(web?.user).toBe('before');
  });

  it('순환 Include는 무한 반복하지 않는다', () => {
    const a: SshConfigFile = { path: '/x/a', text: 'Host a\nInclude b\n' };
    const b: SshConfigFile = { path: '/x/b', text: 'Host b\nInclude a\n' };
    const hosts = parseSshConfig([a], (p) => (p === 'b' ? [b] : [a]));
    expect(hosts.map((h) => h.alias)).toEqual(['a', 'b']);
  });

  it('자기 자신을 포함해도 끝난다', () => {
    const hosts = parseSshConfig([{ path: MAIN, text: 'Host a\nInclude self\n' }], () => [
      { path: MAIN, text: 'Host a\nInclude self\n' },
    ]);
    expect(hosts.map((h) => h.alias)).toEqual(['a']);
  });

  it('재귀 깊이는 16단계까지만', () => {
    const resolve = (pattern: string): SshConfigFile[] => {
      const n = Number(pattern);
      return [{ path: `/x/${n}`, text: `Host h${n}\nInclude ${n + 1}\n` }];
    };
    const hosts = parseSshConfig([{ path: MAIN, text: 'Include 1\n' }], resolve);
    expect(hosts.map((h) => h.alias)).toEqual(Array.from({ length: 16 }, (_, i) => `h${i + 1}`));
  });
});

describe('parseSshConfig Match / 미지원', () => {
  it('Match 블록 안의 지시어는 무시하고 결과에 영향이 없다', () => {
    const hosts = parse(
      [
        'Host web',
        '  Port 22',
        'Match host web',
        '  User ignored',
        '  Port 9999',
        'Host db',
        '  User kept',
      ].join('\n'),
    );
    expect(hosts.map((h) => [h.alias, h.user, h.port])).toEqual([
      ['web', null, 22],
      ['db', 'kept', null],
    ]);
  });

  it('Match 뒤의 Host 가 다시 블록을 연다', () => {
    const hosts = parse(['Match all', '  User m', 'Host a', '  User a'].join('\n'));
    expect(hosts[0]?.user).toBe('a');
  });

  it('미지원 지시어는 소문자 키로 원문을 보존한다', () => {
    const [host] = parse(
      [
        'Host web',
        '  LocalForward 8080 localhost:80',
        '  ForwardAgent yes',
        '  localforward x',
      ].join('\n'),
    );
    expect(host?.unsupported).toEqual({
      localforward: '8080 localhost:80',
      forwardagent: 'yes',
    });
    expect(host?.needsApproval).toEqual([]);
  });

  it('SEC-12 ProxyCommand를 보존하고 승인 필요로 표시한다', () => {
    const [host] = parse('Host web\n  ProxyCommand ssh -W %h:%p bastion\n');
    expect(host?.unsupported).toEqual({ proxycommand: 'ssh -W %h:%p bastion' });
    expect(host?.needsApproval).toEqual(['proxycommand']);
  });

  it('SEC-12 LocalCommand는 PermitLocalCommand와 함께 보존, LocalCommand만 승인 필요', () => {
    const [host] = parse('Host web\n  PermitLocalCommand yes\n  LocalCommand echo hi\n');
    expect(host?.unsupported).toEqual({ permitlocalcommand: 'yes', localcommand: 'echo hi' });
    expect(host?.needsApproval).toEqual(['localcommand']);
  });

  it('SEC-12 Host * 의 ProxyCommand도 각 alias에 승인 필요로 전파된다', () => {
    const [host] = parse('Host web\nHost *\n  ProxyCommand nc %h %p\n');
    expect(host?.needsApproval).toEqual(['proxycommand']);
  });

  it('SEC-12 Match 블록 안의 ProxyCommand는 무시한다', () => {
    const [host] = parse('Host web\nMatch all\n  ProxyCommand evil\n');
    expect(host?.unsupported).toEqual({});
    expect(host?.needsApproval).toEqual([]);
  });

  it('SEC-12 ProxyCommand none은 실행 항목이 아니다', () => {
    const [host] = parse('Host web\n  ProxyCommand none\n');
    expect(host?.unsupported).toEqual({ proxycommand: 'none' });
    expect(host?.needsApproval).toEqual([]);
  });
});
