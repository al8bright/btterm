import type { MessagePortMain } from 'electron';
import { describe, expect, it } from 'vitest';
import type { HostToMainControl, MainToHostControl } from '@btterm/core';
import { FakeSshTransport, newTestTracker } from '@btterm/core/testing';
import { createHostControl, type HostFiles } from './hostControl';

type HostKeys = ConstructorParameters<typeof FakeSshTransport>[0]['hostKeys'];

function setup(
  hostKeys: HostKeys = [
    { keyType: 'ssh-ed25519', key: 'AAAAED', fingerprint: 'SHA256:ed' },
    { keyType: 'ecdsa-sha2-nistp256', key: 'AAAAEC', fingerprint: 'SHA256:ec' },
  ],
) {
  const posted: HostToMainControl[] = [];
  const handled: MainToHostControl[] = [];
  const discarded: string[] = [];
  const files: HostFiles = {
    handle: async (message) => {
      handled.push(message);
    },
    discardSession: async (sessionId) => {
      discarded.push(sessionId);
    },
    sessionEnded: () => undefined,
  };
  const transport = new FakeSshTransport({
    users: { alice: 'pw' },
    hostKeys,
  });
  const tracker = newTestTracker();
  const control = createHostControl({
    post: (message) => posted.push(message),
    transport,
    tracker,
    createFiles: () => files,
  });
  return { control, posted, handled, discarded, transport };
}

/** MessagePortMain 대신 쓰는 최소 포트 */
function fakePort(): MessagePortMain {
  return {
    postMessage: () => undefined,
    on: () => undefined,
    off: () => undefined,
    start: () => undefined,
    close: () => undefined,
  } as unknown as MessagePortMain;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('session host 제어 메시지 (parentPort 진입점)', () => {
  it('TR2 전송 다시 시도·정리 메시지를 전송 처리기로 넘긴다', async () => {
    const { control, handled } = setup();
    control.onMessage({ type: 'transferRetry', transferId: 't1' }, []);
    control.onMessage({ type: 'transferDiscard', transferId: 't2' }, []);
    control.onMessage({ type: 'transferCancel', transferId: 't3' }, []);
    await tick();
    expect(handled).toEqual([
      { type: 'transferRetry', transferId: 't1' },
      { type: 'transferDiscard', transferId: 't2' },
      { type: 'transferCancel', transferId: 't3' },
    ]);
  });

  it('스키마를 통과하지 못한 메시지는 버린다', async () => {
    const { control, handled, posted } = setup();
    control.onMessage({ type: 'transferRetry' }, []);
    control.onMessage({ type: 'exec', command: 'rm -rf /' }, []);
    control.onMessage('transferDiscard', []);
    await tick();
    expect(handled).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('SEC-3 open의 알려진 키 종류를 SSH 엔진까지 넘겨 서버가 그 종류를 제시하게 한다', async () => {
    const { control, posted, transport } = setup();
    control.onMessage(
      {
        type: 'open',
        sessionId: 's1',
        host: 'h',
        port: 22,
        username: 'alice',
        keepaliveSec: 0,
        knownHostKeyTypes: ['ecdsa-sha2-nistp256'],
        auth: [{ kind: 'password', password: 'pw' }],
        size: { cols: 80, rows: 24 },
      },
      [fakePort()],
    );
    await tick();
    expect(transport.lastConnectOptions?.knownHostKeyTypes).toEqual(['ecdsa-sha2-nistp256']);
    const check = posted.find((m) => m.type === 'hostKeyCheck');
    expect(check).toMatchObject({ keyType: 'ecdsa-sha2-nistp256', fingerprint: 'SHA256:ec' });
    // 거부해 세션을 끝낸다
    control.onMessage(
      {
        type: 'hostKeyDecision',
        requestId: (check as { requestId: string }).requestId,
        accept: false,
      },
      [],
    );
    await tick();
    expect(posted.at(-1)).toMatchObject({
      type: 'state',
      state: 'failed',
      errorCode: 'host-key-rejected',
    });
  });

  it('SEC-3 경계 상한을 넘는 호스트 키는 묻지 않고 거부한다(응답 없는 확인 요청으로 멈추지 않는다)', async () => {
    const { control, posted } = setup([
      { keyType: 'ssh-ed25519', key: 'A'.repeat(16 * 1024 + 1), fingerprint: 'SHA256:big' },
    ]);
    control.onMessage(
      {
        type: 'open',
        sessionId: 's1',
        host: 'h',
        port: 22,
        username: 'alice',
        keepaliveSec: 0,
        auth: [{ kind: 'password', password: 'pw' }],
        size: { cols: 80, rows: 24 },
      },
      [fakePort()],
    );
    await tick();
    expect(posted.some((m) => m.type === 'hostKeyCheck')).toBe(false);
    expect(posted.at(-1)).toMatchObject({
      type: 'state',
      state: 'failed',
      errorCode: 'host-key-rejected',
    });
  });
});
