import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { describeSshTransportContract } from '@btterm/core/testing';
import { Ssh2Transport } from './Ssh2Transport';
import { blackhole, resetSshProxy, SSH_PROXY } from '../../../test/toxiproxy';

// test/sshd/compose.yml 의 target 서비스(127.0.0.1:2222)
const env = {
  host: '127.0.0.1',
  port: 2222,
  username: 'btterm',
  password: 'btterm-pw',
};

describeSshTransportContract('ssh2 + Docker sshd', async () => ({
  transport: new Ssh2Transport(),
  ...env,
  // linuxserver/openssh-server는 ssh-keygen -A로 세 종류를 모두 만든다
  hostKeyTypes: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
}));

describe('Ssh2Transport 고유 동작', () => {
  it('제시된 호스트 키를 known_hosts 형식(keyType, base64)과 SHA256 지문으로 넘긴다', async () => {
    let seen: { keyType: string; key: string; fingerprint: string } | undefined;
    const conn = await new Ssh2Transport().connect(
      { ...env, keepaliveSec: 0 },
      [{ kind: 'password', password: env.password }],
      {
        verifyHostKey: async (key) => {
          seen = key;
          return true;
        },
      },
    );
    conn.end();
    expect(seen?.keyType).toMatch(/^(ssh-ed25519|ecdsa-sha2-nistp256|rsa-sha2-512|ssh-rsa)$/);
    expect(seen?.key).toMatch(/^AAAA/);
    expect(seen?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it('AC12 서버 쪽 세션 프로세스가 죽으면(우리가 끝내지 않은 종료) closed 오류로 알린다', async () => {
    const conn = await new Ssh2Transport().connect(
      { ...env, keepaliveSec: 0 },
      [{ kind: 'password', password: env.password }],
      { verifyHostKey: async () => true },
    );
    const shell = await conn.openShell({ cols: 80, rows: 24 });
    const closed = new Promise<{ code?: string } | undefined>((resolve) => conn.onClose(resolve));
    shell.write('echo drop-marker\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    // root는 btterm 사용자의 프로세스를 볼 수 없어 btterm으로 실행한다.
    execFileSync('docker', [
      'exec',
      '-u',
      'btterm',
      'btterm-test-target-1',
      'pkill',
      '-KILL',
      '-f',
      'btterm@pts',
    ]);
    expect((await closed)?.code).toBe('closed');
  });

  it('AC12 응답 없는 단절은 keepalive 간격 × 3 + 2초 안에 timeout으로 알린다', async () => {
    await resetSshProxy();
    const keepaliveSec = 1;
    const conn = await new Ssh2Transport().connect(
      { ...env, host: SSH_PROXY.host, port: SSH_PROXY.port, keepaliveSec },
      [{ kind: 'password', password: env.password }],
      { verifyHostKey: async () => true },
    );
    const shell = await conn.openShell({ cols: 80, rows: 24 });
    shell.onData(() => undefined);
    const closed = new Promise<{ code?: string } | undefined>((resolve) => conn.onClose(resolve));

    await blackhole();
    const started = Date.now();
    const error = await closed;
    expect(error?.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan((keepaliveSec * 3 + 2) * 1000);
    await resetSshProxy();
  });

  it('F3.17a SFTP로 홈 기준 파일 끝부분을 읽고, 없는 파일은 missing', async () => {
    execFileSync('docker', [
      'exec',
      'btterm-test-target-1',
      'sh',
      '-c',
      "printf 'first\\nsecond\\nthird\\n' > /config/.btterm-tail && chown btterm /config/.btterm-tail",
    ]);
    const conn = await new Ssh2Transport().connect(
      { ...env, keepaliveSec: 0 },
      [{ kind: 'password', password: env.password }],
      { verifyHostKey: async () => true },
    );
    const whole = await conn.readFileTail('.btterm-tail', 1024);
    expect(whole.status === 'ok' && new TextDecoder().decode(whole.bytes)).toBe(
      'first\nsecond\nthird\n',
    );
    const tail = await conn.readFileTail('.btterm-tail', 7);
    expect(tail).toMatchObject({ status: 'ok', truncated: true });
    expect(tail.status === 'ok' && new TextDecoder().decode(tail.bytes)).toBe('\nthird\n');
    expect(await conn.readFileTail('.no-such-file', 1024)).toEqual({ status: 'missing' });
    conn.end();
  });

  it('셸에서 exit하면 오류 없이 닫힌다', async () => {
    const conn = await new Ssh2Transport().connect(
      { ...env, keepaliveSec: 0 },
      [{ kind: 'password', password: env.password }],
      { verifyHostKey: async () => true },
    );
    const shell = await conn.openShell({ cols: 80, rows: 24 });
    shell.onData(() => undefined);
    shell.onClose(() => conn.end());
    const closed = new Promise<unknown>((resolve) => conn.onClose(resolve));
    shell.write('exit\n');
    expect(await closed).toBeUndefined();
  });

  it('AC9 호스트 키 답을 기다리는 시간은 접속 제한 시간에 들지 않는다(지문을 천천히 비교해도 끊기지 않음)', async () => {
    const conn = await new Ssh2Transport().connect(
      { ...env, keepaliveSec: 0, readyTimeoutMs: 800 },
      [{ kind: 'password', password: env.password }],
      {
        verifyHostKey: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return true;
        },
      },
    );
    conn.end();
  });

  it('응답 없는 서버는 접속 제한 시간이 지나면 timeout', async () => {
    await resetSshProxy();
    await blackhole();
    const started = Date.now();
    const error = await new Ssh2Transport()
      .connect(
        {
          ...env,
          host: SSH_PROXY.host,
          port: SSH_PROXY.port,
          keepaliveSec: 0,
          readyTimeoutMs: 1000,
        },
        [{ kind: 'password', password: env.password }],
        { verifyHostKey: async () => true },
      )
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(3000);
    await resetSshProxy();
  });

  it('닫힌 포트면 refused', async () => {
    const error = await new Ssh2Transport()
      .connect({ ...env, port: 1, keepaliveSec: 0 }, [], { verifyHostKey: async () => true })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('refused');
  });
});
