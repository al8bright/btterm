import { describe, expect, it } from 'vitest';
import { SshError, type FixedCommand, type SshTransport } from '../ssh/SshTransport';

export interface SshContractEnv {
  transport: SshTransport;
  host: string;
  port: number;
  username: string;
  password: string;
  cleanup?: () => Promise<void> | void;
}

const accept = { verifyHostKey: async () => true };
const reject = { verifyHostKey: async () => false };

/**
 * SshTransport 계약 테스트(D6). Fake(단위)와 ssh2 어댑터(통합, Docker sshd)에 같은 스위트를 돌린다.
 */
export function describeSshTransportContract(
  name: string,
  createEnv: () => Promise<SshContractEnv>,
) {
  describe(`SshTransport 계약: ${name}`, () => {
    const opts = (env: SshContractEnv) => ({
      host: env.host,
      port: env.port,
      username: env.username,
      keepaliveSec: 0,
      readyTimeoutMs: 5000,
    });

    it('AC9 호스트 키를 거부하면 host-key-rejected로 실패한다', async () => {
      const env = await createEnv();
      const error = await env.transport
        .connect(opts(env), [{ kind: 'password', password: env.password }], reject)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SshError);
      expect((error as SshError).code).toBe('host-key-rejected');
      await env.cleanup?.();
    });

    it('AC15 비밀번호가 틀리면 auth-failed로 실패한다', async () => {
      const env = await createEnv();
      const error = await env.transport
        .connect(opts(env), [{ kind: 'password', password: `${env.password}-wrong` }], accept)
        .catch((e: unknown) => e);
      expect((error as SshError).code).toBe('auth-failed');
      await env.cleanup?.();
    });

    it('접속 후 셸에 쓴 명령의 출력을 받는다', async () => {
      const env = await createEnv();
      const conn = await env.transport.connect(
        opts(env),
        [{ kind: 'password', password: env.password }],
        accept,
      );
      const shell = await conn.openShell({ cols: 80, rows: 24 });
      const decoder = new TextDecoder();
      let output = '';
      const seen = new Promise<void>((resolve) => {
        const sub = shell.onData((chunk) => {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes('btterm-ok-42')) {
            sub.dispose();
            resolve();
          }
        });
      });
      shell.write('echo btterm-ok-$((40+2))\n');
      await seen;
      shell.close();
      conn.end();
      await env.cleanup?.();
    });

    it('F3.18 execCapture는 표준 출력을 상한까지 받고, 끝난 연결에서는 null', async () => {
      const env = await createEnv();
      const conn = await env.transport.connect(
        opts(env),
        [{ kind: 'password', password: env.password }],
        accept,
      );
      const decode = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);
      expect(
        decode(await conn.execCapture('echo btterm-exec-$((40+2))' as FixedCommand, 1024, 5000)),
      ).toContain('btterm-exec-42');
      const long = await conn.execCapture(`echo ${'x'.repeat(200)}` as FixedCommand, 50, 5000);
      expect(long?.length).toBeLessThanOrEqual(50);
      conn.end();
      expect(await conn.execCapture('echo after' as FixedCommand, 1024, 5000)).toBeNull();
      await env.cleanup?.();
    });

    it('end() 하면 onClose가 호출된다', async () => {
      const env = await createEnv();
      const conn = await env.transport.connect(
        opts(env),
        [{ kind: 'password', password: env.password }],
        accept,
      );
      const closed = new Promise<void>((resolve) => {
        const sub = conn.onClose(() => {
          sub.dispose();
          resolve();
        });
      });
      conn.end();
      await closed;
      await env.cleanup?.();
    });
  });
}
