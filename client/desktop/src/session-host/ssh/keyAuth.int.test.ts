import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { RemoteFiles, SshError, type AuthMethod } from '@btterm/core';
import { Ssh2Transport } from './Ssh2Transport';
import { generateKey } from './keyGenerator';
import { inspectKey } from './keyInspector';
import { opensshEd25519, pemRsa } from '../../../test/keys';
import { sshAgentPath } from '../../platform/paths';

const env = { host: '127.0.0.1', port: 2222, username: 'btterm', keepaliveSec: 0 };
const accept = { verifyHostKey: async () => true };

const ed = opensshEd25519('pw-123');
const rsa = pemRsa();

function authorize(publicLine: string): void {
  execFileSync('docker', [
    'exec',
    'btterm-test-target-1',
    'sh',
    '-c',
    `echo '${publicLine}' >> /config/.ssh/authorized_keys`,
  ]);
}

beforeAll(() => {
  authorize(ed.publicLine);
  const rsaInfo = inspectKey(rsa.privateKey);
  if (!rsaInfo.ok) throw new Error('RSA 테스트 키 생성 실패');
  authorize(rsaInfo.publicKey);
});

async function echoWith(auth: AuthMethod[]): Promise<string> {
  const conn = await new Ssh2Transport().connect(env, auth, accept);
  const shell = await conn.openShell({ cols: 80, rows: 24 });
  let out = '';
  await new Promise<void>((resolve) => {
    shell.onData((chunk) => {
      out += new TextDecoder().decode(chunk);
      if (out.includes('key-ok-7')) resolve();
    });
    shell.write('echo key-ok-$((3+4))\n');
  });
  conn.end();
  return out;
}

describe('개인키·agent 인증 (실제 sshd)', () => {
  it('F2.1 passphrase로 보호된 OpenSSH ed25519 키로 접속한다', async () => {
    const out = await echoWith([
      { kind: 'privateKey', privateKey: ed.privateKey, passphrase: 'pw-123' },
    ]);
    expect(out).toContain('key-ok-7');
  });

  it('F2.1 PEM RSA 키로 접속한다', async () => {
    expect(await echoWith([{ kind: 'privateKey', privateKey: rsa.privateKey }])).toContain(
      'key-ok-7',
    );
  });

  it('F6.5 passphrase가 틀리면 네트워크에 가기 전에 bad-passphrase', async () => {
    const error = await new Ssh2Transport()
      .connect(env, [{ kind: 'privateKey', privateKey: ed.privateKey, passphrase: 'x' }], accept)
      .catch((e: unknown) => e);
    expect((error as SshError).code).toBe('bad-passphrase');
  });

  it('F6.5 agent 파이프가 없으면 agent-unavailable', async () => {
    const error = await new Ssh2Transport()
      .connect(env, [{ kind: 'agent', agentPath: '\\\\.\\pipe\\btterm-no-such-agent' }], accept)
      .catch((e: unknown) => e);
    expect((error as SshError).code).toBe('agent-unavailable');
  });

  it('F2.2 OS 기본 agent(Windows 파이프·macOS SSH_AUTH_SOCK)에 연결된다(테스트 서버가 모르는 키라 auth-failed)', async () => {
    const agentPath = sshAgentPath();
    if (!agentPath) throw new Error('SSH_AUTH_SOCK이 없어 agent 테스트를 할 수 없다');
    const error = await new Ssh2Transport()
      .connect(env, [{ kind: 'agent', agentPath }], accept)
      .catch((e: unknown) => e);
    expect((error as SshError).code).toBe('auth-failed');
  });
});

describe('새 키 생성 → 서버 등록 → 그 키로 접속 (F7.7, F7.8, 실제 sshd)', () => {
  it('비밀번호 세션으로 공개키를 등록하면 그 키로 로그인되고, 두 번 등록해도 한 줄이다', async () => {
    const key = await generateKey({ keyType: 'ed25519', passphrase: 'gen-pw', comment: '' });
    const info = inspectKey(new TextEncoder().encode(key.privateKey), 'gen-pw');
    if (!info.ok) throw new Error('생성한 키를 읽지 못함');

    const conn = await new Ssh2Transport().connect(
      env,
      [{ kind: 'password', password: 'btterm-pw' }],
      accept,
    );
    const files = new RemoteFiles(() => conn.openSftp());
    expect(await files.installPublicKey(info.publicKey)).toEqual({ added: true });
    expect(await files.installPublicKey(info.publicKey)).toEqual({ added: false });
    files.close();
    conn.end();

    const out = await echoWith([
      {
        kind: 'privateKey',
        privateKey: new TextEncoder().encode(key.privateKey),
        passphrase: 'gen-pw',
      },
    ]);
    expect(out).toContain('key-ok-7');
  });
});
