import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransferQueue, type TransferJob, type TransferStatus } from '@btterm/core';
import { FakeClock, FakeRemoteFs, FakeSftp, newTestTracker } from '@btterm/core/testing';
import { createTransferEndpoints, safeLocalTarget } from './transferEndpoints';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-xfer-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sha = (data: Uint8Array | Buffer) => createHash('sha256').update(data).digest('hex');

function setup() {
  const remote = new FakeRemoteFs('/home/u');
  const statuses: TransferStatus[] = [];
  const queue = new TransferQueue({
    endpoints: createTransferEndpoints(async () => new FakeSftp(remote)),
    clock: new FakeClock(),
    tracker: newTestTracker(),
    platform: 'windows',
    ids: { next: () => 'id' },
    askConflict: async () => ({ decision: 'rename' }),
    onStatus: (s) => statuses.push(s),
  });
  const done = (id: string) =>
    new Promise<TransferStatus>((resolve) => {
      const check = () => {
        const last = statuses.filter((s) => s.id === id).at(-1);
        if (last && ['done', 'failed', 'cancelled', 'skipped'].includes(last.state)) resolve(last);
        else setTimeout(check, 5);
      };
      check();
    });
  return { remote, queue, done };
}

const job = (
  partial: Partial<TransferJob> & Pick<TransferJob, 'id' | 'direction'>,
): TransferJob => ({
  sessionId: 's1',
  sourcePath: '',
  targetDir: '',
  name: '',
  ...partial,
});

describe('전송 끝점(로컬 파일 ↔ SFTP)', () => {
  it('AC7 한글 파일을 내려받았다가 다시 올리면 이름이 같고 SHA-256이 같다', async () => {
    const { remote, queue, done } = setup();
    const content = new TextEncoder().encode('보고서 내용 '.repeat(1000));
    remote.nodes.set('/home/u/보고서_최종.txt', {
      type: 'file',
      data: content,
      mode: 0o644,
      mtimeMs: 0,
    });

    queue.enqueue(
      job({
        id: 'd',
        direction: 'download',
        sourcePath: '/home/u/보고서_최종.txt',
        targetDir: dir,
        name: '보고서_최종.txt',
      }),
    );
    expect((await done('d')).state).toBe('done');
    expect(await readdir(dir)).toEqual(['보고서_최종.txt']);
    const local = await readFile(join(dir, '보고서_최종.txt'));
    expect(sha(local)).toBe(sha(content));

    remote.nodes.set('/home/u/up', {
      type: 'dir',
      data: new Uint8Array(),
      mode: 0o755,
      mtimeMs: 0,
    });
    queue.enqueue(
      job({
        id: 'u',
        direction: 'upload',
        sourcePath: join(dir, '보고서_최종.txt'),
        targetDir: '/home/u/up',
        name: '보고서_최종.txt',
      }),
    );
    expect((await done('u')).state).toBe('done');
    expect(sha(remote.nodes.get('/home/u/up/보고서_최종.txt')!.data)).toBe(sha(content));
    queue.dispose();
  });

  it('로컬 충돌은 기존 파일 이름으로 감지하고, 받는 중에는 .btterm-part만 쓴다', async () => {
    const { remote, queue, done } = setup();
    remote.writeText('a.txt', 'new');
    await writeFile(join(dir, 'a.txt'), 'old');
    queue.enqueue(
      job({ id: 'd', direction: 'download', sourcePath: 'a.txt', targetDir: dir, name: 'a.txt' }),
    );
    await done('d');
    expect((await readdir(dir)).sort()).toEqual(['a (1).txt', 'a.txt']);
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('old');
    queue.dispose();
  });

  it('SEC-11 대상 폴더 밖으로 나가는 이름은 거부한다', () => {
    expect(safeLocalTarget(dir, 'ok.txt')).toBe(join(dir, 'ok.txt'));
    // 구분자·절대 경로 형식은 OS마다 다르다(Windows: ..\\evil.txt, C:\\x / macOS: ../evil.txt, /x)
    expect(() => safeLocalTarget(dir, join('..', 'evil.txt'))).toThrow();
    expect(() => safeLocalTarget(dir, resolve(sep, 'x'))).toThrow();
  });
});
