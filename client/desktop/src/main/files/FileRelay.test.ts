import { describe, expect, it } from 'vitest';
import type { WebContents } from 'electron';
import type { MainToHostControl, MainToRendererEvent, Prompt } from '@btterm/core';
import { FileRelay } from './FileRelay';

const fakeSender = () => ({ isDestroyed: () => false }) as unknown as WebContents;

function setup() {
  const owner = fakeSender();
  const other = fakeSender();
  const posted: MainToHostControl[] = [];
  const sent: MainToRendererEvent[] = [];
  const asked: Prompt[] = [];
  const relay = new FileRelay({
    post: (m) => posted.push(m),
    ownerOf: (id) => (id === 's1' ? owner : undefined),
    isReady: (id) => id === 's1',
    ask: async (_sender, prompt) => {
      asked.push(prompt);
      return { kind: 'conflict', decision: 'rename', applyAll: true };
    },
    send: (_sender, event) => sent.push(event),
    chooseFolder: async () => 'C:/Downloads',
    chooseFiles: async () => ['C:/a.txt'],
    consumeDropped: (_sender, paths) => paths.every((p) => p.startsWith('C:/dropped/')),
  });
  return { relay, owner, other, posted, sent, asked };
}

describe('FileRelay', () => {
  it('세션을 연 창만 파일 작업을 할 수 있다', async () => {
    const { relay, other, posted } = setup();
    expect(
      await relay.handle(other, {
        type: 'files.op',
        sessionId: 's1',
        op: { kind: 'list', path: '.' },
      }),
    ).toEqual({ ok: false, error: 'unavailable' });
    expect(posted).toEqual([]);
  });

  it('파일 작업을 host에 보내고 결과를 돌려준다', async () => {
    const { relay, owner, posted } = setup();
    const pending = relay.handle(owner, {
      type: 'files.op',
      sessionId: 's1',
      op: { kind: 'list', path: '.' },
    });
    const sentOp = posted[0] as Extract<MainToHostControl, { type: 'files' }>;
    await relay.handleHost({
      type: 'filesResult',
      requestId: sentOp.requestId,
      ok: true,
      result: { path: '/home/u', entries: [] },
    });
    expect(await pending).toEqual({ ok: true, result: { path: '/home/u', entries: [] } });
  });

  it('F7.8 공개키 등록은 세션 주인 창만, host 전용 작업으로 보낸다', async () => {
    const { relay, owner, other, posted } = setup();
    expect(await relay.installKey(other, 's1', 'ssh-ed25519 AAAA')).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(posted).toEqual([]);
    const pending = relay.installKey(owner, 's1', 'ssh-ed25519 AAAA');
    const sent = posted[0] as Extract<MainToHostControl, { type: 'files' }>;
    expect(sent.op).toEqual({ kind: 'installKey', publicKey: 'ssh-ed25519 AAAA' });
    await relay.handleHost({
      type: 'filesResult',
      requestId: sent.requestId,
      ok: true,
      result: { added: true },
    });
    expect(await pending).toEqual({ ok: true, result: { added: true } });
  });

  it('다운로드는 고른 폴더로 원격 파일마다 전송 작업을 만든다', async () => {
    const { relay, owner, posted } = setup();
    const result = (await relay.handle(owner, {
      type: 'files.download',
      sessionId: 's1',
      remotePaths: ['/var/log/syslog', '/srv/보고서.txt'],
    })) as { transferIds: string[] };
    expect(result.transferIds).toHaveLength(2);
    expect(posted.map((m) => m.type === 'transfer' && m.job)).toEqual([
      expect.objectContaining({ direction: 'download', targetDir: 'C:/Downloads', name: 'syslog' }),
      expect.objectContaining({ sourcePath: '/srv/보고서.txt', name: '보고서.txt' }),
    ]);
  });

  it('TR3 로컬 편집: 받기가 끝나면 열고, 탭을 닫으면 임시 파일을 지운다', async () => {
    const opened: string[] = [];
    const removed: string[] = [];
    const posted: MainToHostControl[] = [];
    const owner = fakeSender();
    const relay = new FileRelay({
      post: (m) => posted.push(m),
      ownerOf: () => owner,
      isReady: () => true,
      ask: async () => ({ kind: 'cancel' }),
      send: () => undefined,
      chooseFolder: async () => null,
      chooseFiles: async () => [],
      consumeDropped: () => false,
      edits: {
        tempRoot: 'C:/edit',
        platform: 'windows',
        openPath: async (path) => {
          opened.push(path);
          return true;
        },
        isFile: async () => true,
        watch: () => () => undefined,
        makeDir: async () => undefined,
        remove: async (path) => {
          removed.push(path);
        },
      },
    });
    const pending = relay.handle(owner, {
      type: 'files.editLocal',
      sessionId: 's1',
      remotePath: '/etc/app.conf',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const job = (posted[0] as Extract<MainToHostControl, { type: 'transfer' }>).job;
    expect(job).toMatchObject({ direction: 'download', sourcePath: '/etc/app.conf' });
    await relay.handleHost({
      type: 'transferStatus',
      status: {
        id: job.id,
        sessionId: 's1',
        direction: 'download',
        name: 'app.conf',
        state: 'done',
        bytes: 1,
        total: 1,
      },
    });
    const result = (await pending) as { ok: boolean; editId: string };
    expect(result.ok).toBe(true);
    expect(opened).toHaveLength(1);
    await relay.sessionClosed('s1');
    expect(removed).toHaveLength(1);
  });

  it('TR2 실패한 전송은 시작한 창만 다시 시도·정리할 수 있다', async () => {
    const { relay, owner, other, posted } = setup();
    const { transferIds } = (await relay.handle(owner, {
      type: 'files.download',
      sessionId: 's1',
      remotePaths: ['/srv/a.bin'],
    })) as { transferIds: string[] };
    const id = transferIds[0]!;
    await relay.handleHost({
      type: 'transferStatus',
      status: {
        id,
        sessionId: 's1',
        direction: 'download',
        name: 'a.bin',
        state: 'failed',
        bytes: 3,
        total: 9,
        error: 'closed',
      },
    });
    expect(await relay.handle(other, { type: 'transfer.retry', transferId: id })).toEqual({
      ok: false,
      error: 'not-found',
    });
    await relay.handle(owner, { type: 'transfer.retry', transferId: id });
    expect(posted.at(-1)).toEqual({ type: 'transferRetry', transferId: id });
    await relay.handle(owner, { type: 'transfer.discard', transferId: id });
    expect(posted.at(-1)).toEqual({ type: 'transferDiscard', transferId: id });
    expect(await relay.handle(owner, { type: 'transfer.retry', transferId: id })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('F4.7 폴더 올리기는 폴더 선택 창으로 고른 폴더를 올린다', async () => {
    const { relay, owner, posted } = setup();
    await relay.handle(owner, {
      type: 'files.upload',
      sessionId: 's1',
      remoteDir: '/srv',
      pick: 'folder',
    });
    expect(posted.map((m) => m.type === 'transfer' && m.job)).toEqual([
      expect.objectContaining({
        direction: 'upload',
        sourcePath: 'C:/Downloads',
        name: 'Downloads',
      }),
    ]);
  });

  it('F4.7 폴더를 펼친 하위 전송 상태는 화면에 보내지 않는다', async () => {
    const { relay, owner, sent } = setup();
    const { transferIds } = (await relay.handle(owner, {
      type: 'files.download',
      sessionId: 's1',
      remotePaths: ['/srv/app'],
    })) as { transferIds: string[] };
    const status = { sessionId: 's1', direction: 'download' as const, bytes: 0, total: 0 };
    await relay.handleHost({
      type: 'transferStatus',
      status: { ...status, id: 'child', name: 'a', state: 'done', parentId: transferIds[0]! },
    });
    expect(sent).toEqual([]);
  });

  it('전송 상태는 시작한 창에만, 충돌 질의는 사용자 답을 host로 돌려준다', async () => {
    const { relay, owner, posted, sent, asked } = setup();
    const { transferIds } = (await relay.handle(owner, {
      type: 'files.upload',
      sessionId: 's1',
      remoteDir: '/tmp',
    })) as { transferIds: string[] };
    await relay.handleHost({
      type: 'transferStatus',
      status: {
        id: transferIds[0]!,
        sessionId: 's1',
        direction: 'upload',
        name: 'a.txt',
        state: 'done',
        bytes: 1,
        total: 1,
      },
    });
    expect(sent).toHaveLength(1);

    await relay.handleHost({
      type: 'transferConflict',
      requestId: 'r1',
      sessionId: 's1',
      name: 'a.txt',
      direction: 'upload',
    });
    expect(asked).toEqual([{ kind: 'fileConflict', name: 'a.txt', direction: 'upload' }]);
    expect(posted.at(-1)).toEqual({
      type: 'conflictAnswer',
      requestId: 'r1',
      decision: 'rename',
      applyAll: true,
    });
  });

  it('끌어 놓기로 등록되지 않은 로컬 경로는 업로드하지 않는다(보안 리뷰 #1)', async () => {
    const { relay, owner, posted } = setup();
    expect(
      await relay.handle(owner, {
        type: 'files.upload',
        sessionId: 's1',
        remoteDir: '/tmp',
        localPaths: ['C:/Users/me/.ssh/id_ed25519'],
      }),
    ).toEqual({ ok: false, error: 'not-allowed' });
    expect(posted).toEqual([]);
    const ok = (await relay.handle(owner, {
      type: 'files.upload',
      sessionId: 's1',
      remoteDir: '/tmp',
      localPaths: ['C:/dropped/a.txt'],
    })) as { ok: boolean };
    expect(ok.ok).toBe(true);
  });

  it('남의 전송은 취소할 수 없다', async () => {
    const { relay, owner, other } = setup();
    const { transferIds } = (await relay.handle(owner, {
      type: 'files.upload',
      sessionId: 's1',
      remoteDir: '/tmp',
    })) as { transferIds: string[] };
    expect(
      await relay.handle(other, { type: 'transfer.cancel', transferId: transferIds[0]! }),
    ).toEqual({ ok: false, error: 'not-found' });
    expect(
      await relay.handle(owner, { type: 'transfer.cancel', transferId: transferIds[0]! }),
    ).toEqual({ ok: true });
  });
});

describe('FileRelay 대기 정리(보안 리뷰 #4)', () => {
  it('host가 끝나면 대기 중인 파일 작업을 unavailable로 끝낸다', async () => {
    const { relay, owner } = setup();
    const pending = relay.handle(owner, {
      type: 'files.op',
      sessionId: 's1',
      op: { kind: 'list', path: '.' },
    });
    relay.failAll('unavailable');
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
  });

  it('응답이 없으면 시간 초과로 끝낸다', async () => {
    const owner = fakeSender();
    const relay = new FileRelay({
      post: () => undefined,
      ownerOf: () => owner,
      isReady: () => true,
      ask: async () => ({ kind: 'cancel' }),
      send: () => undefined,
      chooseFolder: async () => null,
      chooseFiles: async () => [],
      consumeDropped: () => false,
      opTimeoutMs: 20,
    });
    const result = await relay.handle(owner, {
      type: 'files.op',
      sessionId: 's1',
      op: { kind: 'list', path: '.' },
    });
    expect(result).toEqual({ ok: false, error: 'timeout' });
  });
});
