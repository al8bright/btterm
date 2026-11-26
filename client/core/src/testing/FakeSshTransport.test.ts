import { describe, expect, it } from 'vitest';
import { FakeSshTransport } from './FakeSshTransport';
import { describeSshTransportContract } from './sshTransportContract';
import { SshError } from '../ssh/SshTransport';

const create = () => new FakeSshTransport({ users: { alice: 'pw' } });

describeSshTransportContract('Fake', async () => ({
  transport: create(),
  host: 'fake-host',
  port: 22,
  username: 'alice',
  password: 'pw',
}));

describe('FakeSshTransport 고유 동작', () => {
  const opts = { host: 'h', port: 22, username: 'alice', keepaliveSec: 0 };
  const accept = { verifyHostKey: async () => true };

  it('AC9 호스트 키를 거부하면 인증 정보를 보내지 않는다', async () => {
    const fake = create();
    await fake
      .connect(opts, [{ kind: 'password', password: 'pw' }], {
        verifyHostKey: async () => false,
      })
      .catch(() => undefined);
    expect(fake.authAttempts).toBe(0);
  });

  it('failNextConnect로 다음 연결 오류를 지정한다', async () => {
    const fake = create();
    fake.failNextConnect('timeout');
    const error = await fake.connect(opts, [], accept).catch((e: unknown) => e);
    expect((error as SshError).code).toBe('timeout');
  });

  it('dropConnection은 열린 연결을 closed 오류로 끊는다', async () => {
    const fake = create();
    const conn = await fake.connect(opts, [{ kind: 'password', password: 'pw' }], accept);
    const reason = new Promise<SshError | undefined>((resolve) => conn.onClose(resolve));
    fake.dropConnection();
    expect((await reason)?.code).toBe('closed');
  });

  it('셸의 pause 동안은 출력을 보내지 않고 resume하면 보낸다', async () => {
    const fake = create();
    const conn = await fake.connect(opts, [{ kind: 'password', password: 'pw' }], accept);
    const shell = await conn.openShell({ cols: 80, rows: 24 });
    const got: string[] = [];
    shell.onData((c) => got.push(new TextDecoder().decode(c)));
    shell.pause();
    fake.emitShellOutput('hello');
    expect(got).toEqual([]);
    shell.resume();
    expect(got.join('')).toContain('hello');
    conn.end();
  });

  it('resize는 마지막 크기를 기록한다', async () => {
    const fake = create();
    const conn = await fake.connect(opts, [{ kind: 'password', password: 'pw' }], accept);
    const shell = await conn.openShell({ cols: 80, rows: 24 });
    shell.resize({ cols: 120, rows: 40 });
    expect(fake.lastPtySize).toEqual({ cols: 120, rows: 40 });
    conn.end();
  });
});
