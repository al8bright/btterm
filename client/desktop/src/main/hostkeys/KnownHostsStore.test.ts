import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintOf, KnownHostsStore } from './KnownHostsStore';

let dir: string;
let appFile: string;
let userFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-kh-'));
  appFile = join(dir, 'app_known_hosts');
  userFile = join(dir, 'user_known_hosts');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ed = (key: string) => ({ keyType: 'ssh-ed25519', key });
const yes = async () => true;

describe('KnownHostsStore', () => {
  it('AC9 파일이 없으면 unknown', async () => {
    const store = new KnownHostsStore(appFile, userFile);
    expect((await store.evaluate('web-01', 22, ed('AAAA1'))).verdict).toBe('unknown');
  });

  it('trust한 키는 다음부터 trusted', async () => {
    const store = new KnownHostsStore(appFile, userFile);
    await store.trust('web-01', 2222, ed('AAAA1'));
    expect((await store.evaluate('web-01', 2222, ed('AAAA1'))).verdict).toBe('trusted');
    expect(await readFile(appFile, 'utf8')).toBe('[web-01]:2222 ssh-ed25519 AAAA1\n');
  });

  it('사용자 ~/.ssh/known_hosts 항목도 신뢰하지만 그 파일에는 쓰지 않는다', async () => {
    await writeFile(userFile, 'web-01 ssh-ed25519 AAAA1\n', 'utf8');
    const store = new KnownHostsStore(appFile, userFile);
    expect((await store.evaluate('web-01', 22, ed('AAAA1'))).verdict).toBe('trusted');
    await store.trust('db-01', 22, ed('AAAA2'));
    expect(await readFile(userFile, 'utf8')).toBe('web-01 ssh-ed25519 AAAA1\n');
  });

  it('AC10 저장된 키와 다르면 mismatch', async () => {
    await writeFile(appFile, 'web-01 ssh-ed25519 AAAA1\n', 'utf8');
    const store = new KnownHostsStore(appFile, userFile);
    expect((await store.evaluate('web-01', 22, ed('AAAA2'))).verdict).toBe('mismatch');
  });

  it('OpenSSH 해시 항목(|1|salt|hash, HMAC-SHA1)을 실제 알고리즘으로 대조한다', async () => {
    const salt = randomBytes(20);
    const hash = createHmac('sha1', salt).update('web-01').digest();
    await writeFile(
      userFile,
      `|1|${salt.toString('base64')}|${hash.toString('base64')} ssh-ed25519 AAAA1\n`,
      'utf8',
    );
    const store = new KnownHostsStore(appFile, userFile);
    expect((await store.evaluate('web-01', 22, ed('AAAA1'))).verdict).toBe('trusted');
    expect((await store.evaluate('web-02', 22, ed('AAAA1'))).verdict).toBe('unknown');
  });

  it('SEC-3 해시 항목은 소문자 이름으로 만들어지므로 대문자가 섞인 호스트·[host]:port도 찾는다', async () => {
    const hashed = (name: string) => {
      const salt = randomBytes(20);
      const hash = createHmac('sha1', salt).update(name).digest();
      return `|1|${salt.toString('base64')}|${hash.toString('base64')}`;
    };
    await writeFile(
      userFile,
      `${hashed('web-01.corp')} ssh-ed25519 AAAA1\n${hashed('[db-01]:2222')} ssh-ed25519 BBBB2\n`,
      'utf8',
    );
    const store = new KnownHostsStore(appFile, userFile);
    expect((await store.evaluate('Web-01.CORP', 22, ed('AAAA1'))).verdict).toBe('trusted');
    expect((await store.evaluate('DB-01', 2222, ed('BBBB2'))).verdict).toBe('trusted');
    expect((await store.evaluate('DB-01', 2222, ed('CCCC3'))).verdict).toBe('mismatch');
  });

  it('SEC-3 AC10 다른 종류의 키만 저장된 호스트가 새 종류를 내밀면 차단 대상(other-type-known)', async () => {
    await writeFile(userFile, 'web-01 ssh-ed25519 AAAA1\n', 'utf8');
    const store = new KnownHostsStore(appFile, userFile);
    expect(await store.evaluate('web-01', 22, { keyType: 'ssh-rsa', key: 'RSA1' })).toEqual({
      verdict: 'mismatch',
      reason: 'other-type-known',
      known: [{ keyType: 'ssh-ed25519', key: 'AAAA1' }],
    });
  });

  it('SEC-3 연결 설정에 넘길 알려진 키 종류: 두 파일에서 모으고 형식이 이상한 종류는 뺀다', async () => {
    await writeFile(appFile, 'web-01 ecdsa-sha2-nistp256 EC1\nweb-01 SSH-WEIRD X\n', 'utf8');
    await writeFile(userFile, 'web-01 ssh-ed25519 AAAA1\nweb-01 ecdsa-sha2-nistp256 EC2\n', 'utf8');
    const store = new KnownHostsStore(appFile, userFile);
    expect(await store.knownKeyTypes('WEB-01', 22)).toEqual(['ecdsa-sha2-nistp256', 'ssh-ed25519']);
    expect(await store.knownKeyTypes('web-01', 2222)).toEqual([]);
  });

  it('SEC-3 저장 전에 호스트·키 종류·키 형식을 검사한다(한 줄에 다른 항목을 끼워 넣지 못하게)', async () => {
    const store = new KnownHostsStore(appFile, userFile);
    const bad: Array<[string, { keyType: string; key: string }]> = [
      ['web-01 evil', ed('AAAA1')],
      ['web-01,*', ed('AAAA1')],
      ['web-01\n* ssh-ed25519 EVIL', ed('AAAA1')],
      ['*', ed('AAAA1')],
      ['web-0?', ed('AAAA1')],
      ['!web-01', ed('AAAA1')],
      ['|1|abc|def', ed('AAAA1')],
      ['@revoked', ed('AAAA1')],
      ['#web', ed('AAAA1')],
      ['web\u0000', ed('AAAA1')],
      ['web-01', { keyType: 'ssh-ed25519 AAAA1\n*', key: 'AAAA1' }],
      ['web-01', { keyType: 'SSH-ED25519', key: 'AAAA1' }],
      ['web-01', { keyType: 'ssh-ed25519', key: 'AAAA1 comment\n* ssh-ed25519 EVIL' }],
    ];
    for (const [host, key] of bad) {
      await expect(store.trust(host, 22, key), JSON.stringify(host)).rejects.toThrow();
    }
    await expect(readFile(appFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await store.trust('Web-01.corp', 22, ed('AAAA1'));
    await store.trust('fe80::1', 2222, ed('BBBB2'));
    expect(await readFile(appFile, 'utf8')).toBe(
      'web-01.corp ssh-ed25519 AAAA1\n[fe80::1]:2222 ssh-ed25519 BBBB2\n',
    );
  });

  it('F2.4b 목록: 앱 파일 항목은 지울 수 있고, ~/.ssh 항목은 읽기 전용으로 보여 준다', async () => {
    await writeFile(appFile, '[web-01]:2222 ssh-ed25519 AAAA1\n', 'utf8');
    await writeFile(userFile, '|1|c2FsdA==|aGFzaA== ssh-rsa BBBB2\n', 'utf8');
    const store = new KnownHostsStore(appFile, userFile);
    expect(await store.list()).toEqual([
      {
        source: 'app',
        line: 1,
        hosts: '[web-01]:2222',
        keyType: 'ssh-ed25519',
        key: 'AAAA1',
        fingerprint: fingerprintOf('AAAA1'),
        marker: null,
      },
      {
        source: 'user',
        line: 1,
        hosts: null,
        keyType: 'ssh-rsa',
        key: 'BBBB2',
        fingerprint: fingerprintOf('BBBB2'),
        marker: null,
      },
    ]);
  });

  it('F2.4b 지우면 다음 연결 때 처음 보는 키로 다시 확인한다. ~/.ssh 파일은 건드리지 않는다', async () => {
    const store = new KnownHostsStore(appFile, userFile);
    await store.trust('web-01', 22, ed('AAAA1'));
    await store.trust('db-01', 22, ed('CCCC3'));
    await writeFile(userFile, 'web-02 ssh-ed25519 DDDD4\n', 'utf8');
    expect(await store.remove({ line: 1, keyType: 'ssh-ed25519', key: 'AAAA1' }, yes)).toBe(true);
    expect((await store.evaluate('web-01', 22, ed('AAAA1'))).verdict).toBe('unknown');
    expect(await readFile(appFile, 'utf8')).toBe('db-01 ssh-ed25519 CCCC3\n');
    expect(await store.remove({ line: 1, keyType: 'ssh-ed25519', key: 'DDDD4' }, yes)).toBe(false);
    expect(await readFile(userFile, 'utf8')).toBe('web-02 ssh-ed25519 DDDD4\n');
  });

  it('TR6 보안 리뷰 M-1: main 확인을 받지 못하면 지우지 않는다. 확인에는 main이 읽은 항목을 넘긴다', async () => {
    const store = new KnownHostsStore(appFile, userFile);
    await store.trust('web-01', 22, ed('AAAA1'));
    const asked: string[] = [];
    const no = async (entry: { hosts: string | null; fingerprint: string }) => {
      asked.push(`${entry.hosts} ${entry.fingerprint}`);
      return false;
    };
    expect(await store.remove({ line: 1, keyType: 'ssh-ed25519', key: 'AAAA1' }, no)).toBe(false);
    expect(asked).toEqual([`web-01 ${fingerprintOf('AAAA1')}`]);
    expect((await store.evaluate('web-01', 22, ed('AAAA1'))).verdict).toBe('trusted');
  });

  it('TR6 보안 리뷰 L-3: @revoked·@cert-authority 항목은 지우지 않는다(묻지도 않는다)', async () => {
    await writeFile(appFile, '@revoked web-01 ssh-ed25519 AAAA1\n', 'utf8');
    const store = new KnownHostsStore(appFile, userFile);
    let asked = false;
    const ask = async () => (asked = true);
    expect(await store.remove({ line: 1, keyType: 'ssh-ed25519', key: 'AAAA1' }, ask)).toBe(false);
    expect(asked).toBe(false);
  });

  it('TR6 보안 리뷰 L-1: 지우는 동안 저장한 키가 사라지지 않는다', async () => {
    const store = new KnownHostsStore(appFile, userFile);
    await store.trust('web-01', 22, ed('AAAA1'));
    const removing = store.remove({ line: 1, keyType: 'ssh-ed25519', key: 'AAAA1' }, yes);
    const trusting = store.trust('db-01', 22, ed('CCCC3'));
    await Promise.all([removing, trusting]);
    expect(await readFile(appFile, 'utf8')).toBe('db-01 ssh-ed25519 CCCC3\n');
  });

  it('TR6 보안 리뷰 L-2: 잘못된 키 줄이 있어도 목록은 나온다', async () => {
    await writeFile(
      userFile,
      'web-01 ssh-ed25519 !!!notbase64\nweb-02 ssh-ed25519 AAAA1\n',
      'utf8',
    );
    const store = new KnownHostsStore(appFile, userFile);
    const entries = await store.list();
    expect(entries.map((e) => e.fingerprint)).toEqual(['(잘못된 키)', fingerprintOf('AAAA1')]);
  });
});
