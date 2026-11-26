import { describe, expect, it } from 'vitest';
import { FakeClock } from '../time/FakeClock';
import { newTestTracker } from '../testing/trackers';
import {
  TransferQueue,
  type ConflictAnswer,
  type TransferEndpoints,
  type TransferJob,
  type TransferStatus,
} from './TransferQueue';

const enc = (s: string) => new TextEncoder().encode(s);

type Kind = 'file' | 'dir' | 'skip';

/**
 * 메모리 끝점: 원본 파일은 sources, 원본 폴더는 dirs(경로 → 항목), 대상 폴더는 targets(dir → name → bytes).
 * 폴더를 만들면 targets에 빈 폴더(경로 = 대상/이름)가 생긴다. 실패로 남긴 부분 파일은 partials(대상/이름 → bytes).
 * failOnce[경로] = n: 그 원본을 n바이트 읽은 뒤 한 번 끊는다.
 */
function memoryEndpoints(
  sources: Record<string, Uint8Array>,
  dirs: Record<string, Array<{ name: string; kind: Kind }>> = {},
  failOnce: Record<string, number> = {},
) {
  const targets = new Map<string, Map<string, Uint8Array>>();
  const partials = new Map<string, Uint8Array>();
  const madeDirs: string[] = [];
  const sourceOffsets: number[] = [];
  const gates: Array<() => void> = [];
  let blocking = false;
  const openSinks = new Set<string>();
  const concat = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const endpoints: TransferEndpoints = {
    kindOf: async (job) => (dirs[job.sourcePath] ? 'dir' : 'file'),
    children: async (job) =>
      (dirs[job.sourcePath] ?? []).map((e) => ({
        name: e.name,
        path: `${job.sourcePath}/${e.name}`,
        kind: e.kind,
      })),
    makeDir: async (job, name) => {
      const path = `${job.targetDir}/${name}`;
      madeDirs.push(path);
      if (!targets.has(path)) targets.set(path, new Map());
      return path;
    },
    openSource: async (job, start = 0) => {
      const data = sources[job.sourcePath];
      if (!data) throw Object.assign(new Error('missing'), { code: 'missing' });
      sourceOffsets.push(start);
      let offset = start;
      return {
        size: data.length,
        read: async (max) => {
          if (blocking) await new Promise<void>((resolve) => gates.push(resolve));
          const limit = failOnce[job.sourcePath];
          if (limit !== undefined && offset >= limit) {
            delete failOnce[job.sourcePath];
            throw Object.assign(new Error('closed'), { code: 'closed' });
          }
          if (offset >= data.length) return null;
          const chunk = data.slice(offset, offset + max);
          offset += chunk.length;
          return chunk;
        },
        close: async () => undefined,
      };
    },
    targetNames: async (job) => new Set(targets.get(job.targetDir)?.keys() ?? []),
    partSize: async (job, name) => partials.get(`${job.targetDir}/${name}`)?.length ?? 0,
    discardPart: async (job, name) => {
      partials.delete(`${job.targetDir}/${name}`);
    },
    openSink: async (job, name, offset = 0) => {
      const dir = targets.get(job.targetDir) ?? new Map<string, Uint8Array>();
      targets.set(job.targetDir, dir);
      const key = `${job.targetDir}/${name}`;
      const parts: Uint8Array[] =
        offset > 0 ? [(partials.get(key) ?? new Uint8Array()).slice(0, offset)] : [];
      openSinks.add(key);
      return {
        write: async (chunk) => {
          parts.push(chunk);
        },
        finish: async () => {
          openSinks.delete(key);
          partials.delete(key);
          dir.set(name, concat(parts));
        },
        keep: async () => {
          openSinks.delete(key);
          partials.set(key, concat(parts));
        },
        abort: async () => {
          openSinks.delete(key);
          partials.delete(key);
        },
      };
    },
  };
  return {
    endpoints,
    targets,
    partials,
    madeDirs,
    sourceOffsets,
    openSinks,
    block: () => (blocking = true),
    releaseOne: () => gates.shift()?.(),
    releaseAll: () => {
      blocking = false;
      for (const g of gates.splice(0)) g();
    },
  };
}

function setup(
  sources: Record<string, Uint8Array>,
  options: {
    answers?: ConflictAnswer[];
    concurrency?: number;
    platform?: 'windows' | 'posix';
    dirs?: Record<string, Array<{ name: string; kind: Kind }>>;
    maxBatchFiles?: number;
    failOnce?: Record<string, number>;
  } = {},
) {
  const mem = memoryEndpoints(sources, options.dirs, options.failOnce);
  let n = 0;
  const statuses: TransferStatus[] = [];
  const answers = [...(options.answers ?? [])];
  const asked: string[] = [];
  const clock = new FakeClock();
  const queue = new TransferQueue({
    endpoints: mem.endpoints,
    clock,
    tracker: newTestTracker(),
    platform: options.platform ?? 'windows',
    concurrency: options.concurrency ?? 3,
    chunkSize: 4,
    ids: { next: () => `c${++n}` },
    ...(options.maxBatchFiles !== undefined ? { maxBatchFiles: options.maxBatchFiles } : {}),
    askConflict: async (_job, name) => {
      asked.push(name);
      return answers.shift() ?? { decision: 'skip' };
    },
    onStatus: (status) => statuses.push(status),
  });
  const last = (id: string) => statuses.filter((s) => s.id === id).at(-1);
  return { ...mem, queue, statuses, last, asked, clock };
}

const job = (id: string, sourcePath: string, name: string, targetDir = 'C:/dl'): TransferJob => ({
  id,
  sessionId: 's1',
  direction: 'download',
  sourcePath,
  targetDir,
  name,
});

const settle = () => Promise.resolve();
async function drain(times = 200) {
  for (let i = 0; i < times; i++) await settle();
}

describe('확인 없이 덮어쓰기 (F4.8 로컬 편집 업로드, 결정 TR3)', () => {
  it('overwrite 작업은 같은 이름이 있어도 묻지 않고 바꿔 넣는다', async () => {
    const env = setup({ '/a': enc('new') });
    env.targets.set('C:/dl', new Map([['a.txt', enc('old')]]));
    env.queue.enqueue({ ...job('t1', '/a', 'a.txt'), overwrite: true });
    await drain();
    expect(env.asked).toEqual([]);
    expect(new TextDecoder().decode(env.targets.get('C:/dl')?.get('a.txt'))).toBe('new');
    env.queue.dispose();
  });
});

describe('이어받기 (F4.7, 결정 TR2)', () => {
  const data = enc('0123456789ABCDEF');

  it('실패하면 부분 파일을 남기고, 다시 시도하면 그 지점부터 잇는다', async () => {
    const env = setup({ '/big': data }, { failOnce: { '/big': 8 } });
    env.queue.enqueue(job('t1', '/big', 'big.bin'));
    await drain();
    expect(env.last('t1')).toMatchObject({ state: 'failed', error: 'closed', bytes: 8 });
    expect(env.partials.get('C:/dl/big.bin')?.length).toBe(8);

    env.queue.retry('t1');
    await drain();
    expect(env.sourceOffsets).toEqual([0, 8]);
    expect(env.last('t1')).toMatchObject({ state: 'done', bytes: 16, total: 16 });
    expect(new TextDecoder().decode(env.targets.get('C:/dl')?.get('big.bin'))).toBe(
      '0123456789ABCDEF',
    );
    expect(env.partials.size).toBe(0);
    env.queue.dispose();
  });

  it('부분 파일이 원본보다 크면(원본이 바뀜) 처음부터 다시 받는다', async () => {
    const env = setup({ '/big': data }, { failOnce: { '/big': 8 } });
    env.queue.enqueue(job('t1', '/big', 'big.bin'));
    await drain();
    env.partials.set('C:/dl/big.bin', new Uint8Array(32));
    env.queue.retry('t1');
    await drain();
    expect(env.sourceOffsets).toEqual([0, 0]);
    expect(new TextDecoder().decode(env.targets.get('C:/dl')?.get('big.bin'))).toBe(
      '0123456789ABCDEF',
    );
    env.queue.dispose();
  });

  it('실패한 동안에도 대상 이름을 잡아 둔다: 같은 이름 새 전송은 충돌로 묻는다(보안 리뷰 M2)', async () => {
    const env = setup({ '/big': data, '/other': enc('xx') }, { failOnce: { '/big': 8 } });
    env.queue.enqueue(job('t1', '/big', 'big.bin'));
    await drain();
    env.queue.enqueue(job('t2', '/other', 'big.bin'));
    await drain();
    expect(env.asked).toEqual(['big.bin']);
    expect(env.partials.get('C:/dl/big.bin')?.length).toBe(8);
    env.queue.dispose();
  });

  it('원본 크기가 바뀌었으면 이어 붙이지 않고 처음부터 받는다(보안 리뷰 M2)', async () => {
    const sources: Record<string, Uint8Array> = { '/big': data };
    const env = setup(sources, { failOnce: { '/big': 8 } });
    env.queue.enqueue(job('t1', '/big', 'big.bin'));
    await drain();
    sources['/big'] = enc('NEW-CONTENT-OF-20-BY');
    env.queue.retry('t1');
    await drain();
    expect(env.sourceOffsets).toEqual([0, 8, 0]);
    expect(new TextDecoder().decode(env.targets.get('C:/dl')?.get('big.bin'))).toBe(
      'NEW-CONTENT-OF-20-BY',
    );
    env.queue.dispose();
  });

  it('탭을 닫으면 그 세션의 실패한 전송 부분 파일을 지운다(보안 리뷰 L2)', async () => {
    const env = setup({ '/a': data, '/b': data }, { failOnce: { '/a': 4, '/b': 4 } });
    env.queue.enqueue(job('t1', '/a', 'a.bin'));
    env.queue.enqueue({ ...job('t2', '/b', 'b.bin'), sessionId: 's2' });
    await drain();
    await env.queue.discardSession('s1');
    expect([...env.partials.keys()]).toEqual(['C:/dl/b.bin']);
    env.queue.dispose();
  });

  it('실패한 전송을 정리하면 부분 파일을 지운다. 끌 때도 지운다', async () => {
    const env = setup({ '/a': data, '/b': data }, { failOnce: { '/a': 4, '/b': 4 } });
    env.queue.enqueue(job('t1', '/a', 'a.bin'));
    env.queue.enqueue(job('t2', '/b', 'b.bin'));
    await drain();
    expect(env.partials.size).toBe(2);
    env.queue.discard('t1');
    await drain();
    expect([...env.partials.keys()]).toEqual(['C:/dl/b.bin']);
    env.queue.dispose();
    await drain();
    expect(env.partials.size).toBe(0);
  });

  it('폴더를 다시 시도하면 실패한 하위 전송만 잇고 폴더 줄이 끝난다', async () => {
    const env = setup(
      { '/srv/app/a.txt': enc('AAAA'), '/srv/app/b.txt': data },
      {
        dirs: {
          '/srv/app': [
            { name: 'a.txt', kind: 'file' },
            { name: 'b.txt', kind: 'file' },
          ],
        },
        failOnce: { '/srv/app/b.txt': 8 },
      },
    );
    env.queue.enqueue(job('f1', '/srv/app', 'app'));
    await drain(600);
    expect(env.last('f1')).toMatchObject({ state: 'failed', folder: true, bytes: 1, total: 2 });
    env.queue.retry('f1');
    await drain(600);
    expect(env.last('f1')).toMatchObject({ state: 'done', folder: true, bytes: 2, total: 2 });
    expect(new TextDecoder().decode(env.targets.get('C:/dl/app')?.get('b.txt'))).toBe(
      '0123456789ABCDEF',
    );
    env.queue.dispose();
  });
});

describe('폴더째 전송 (F4.7, 결정 TR1)', () => {
  const tree = {
    '/srv/app': [
      { name: 'a.txt', kind: 'file' as const },
      { name: 'conf', kind: 'dir' as const },
      { name: 'link', kind: 'skip' as const },
    ],
    '/srv/app/conf': [{ name: 'b.ini', kind: 'file' as const }],
  };
  const files = { '/srv/app/a.txt': enc('AAAA'), '/srv/app/conf/b.ini': enc('BB') };

  it('대상에 같은 이름 폴더를 만들고 하위 폴더까지 옮긴다. 링크·특수 파일은 건너뛴다', async () => {
    const env = setup(files, { dirs: tree });
    env.queue.enqueue(job('t1', '/srv/app', 'app'));
    await drain(600);
    expect(env.madeDirs).toEqual(['C:/dl/app', 'C:/dl/app/conf']);
    expect(new TextDecoder().decode(env.targets.get('C:/dl/app')?.get('a.txt'))).toBe('AAAA');
    expect(new TextDecoder().decode(env.targets.get('C:/dl/app/conf')?.get('b.ini'))).toBe('BB');
    expect(env.targets.get('C:/dl/app')?.has('link')).toBe(false);
    env.queue.dispose();
  });

  it('화면에는 폴더 한 줄: 진행은 끝난 파일 수 / 찾은 파일 수, 하위 줄은 parentId로 구분', async () => {
    const env = setup(files, { dirs: tree });
    env.queue.enqueue(job('t1', '/srv/app', 'app'));
    await drain(600);
    expect(env.last('t1')).toMatchObject({ state: 'done', folder: true, bytes: 2, total: 2 });
    const children = env.statuses.filter((s) => s.id !== 't1');
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((s) => s.parentId !== undefined)).toBe(true);
    env.queue.dispose();
  });

  it('SEC-11 내려받는 폴더 이름도 로컬 이름으로 정규화한다', async () => {
    const env = setup({}, { dirs: { '/srv/a:b': [] } });
    env.queue.enqueue(job('t1', '/srv/a:b', 'a:b'));
    await drain();
    expect(env.madeDirs).toEqual(['C:/dl/a_b']);
    env.queue.dispose();
  });

  it('한 배치가 상한을 넘으면 폴더를 too-many로 끝내고 더 펼치지 않는다', async () => {
    const env = setup(files, { dirs: tree, maxBatchFiles: 1 });
    env.queue.enqueue(job('t1', '/srv/app', 'app'));
    await drain(600);
    expect(env.last('t1')).toMatchObject({ state: 'failed', error: 'too-many' });
    expect(env.madeDirs).not.toContain('C:/dl/app/conf');
    env.queue.dispose();
  });

  it('폴더를 취소하면 아직 끝나지 않은 하위 전송을 모두 취소한다', async () => {
    const env = setup(files, { dirs: tree, concurrency: 1 });
    env.block();
    env.queue.enqueue(job('t1', '/srv/app', 'app'));
    await drain(100);
    env.queue.cancel('t1');
    env.releaseAll();
    await drain(600);
    expect(env.last('t1')?.state).toBe('cancelled');
    expect(env.targets.get('C:/dl/app/conf')?.size ?? 0).toBe(0);
    env.queue.dispose();
  });
});

describe('TransferQueue (F4.4)', () => {
  it('AC7 한글 파일명을 보존해 내용 그대로 전송하고 done을 알린다', async () => {
    const env = setup({ '/srv/보고서_최종.txt': enc('내용-1234') });
    env.queue.enqueue(job('t1', '/srv/보고서_최종.txt', '보고서_최종.txt'));
    await drain();
    expect(new TextDecoder().decode(env.targets.get('C:/dl')?.get('보고서_최종.txt'))).toBe(
      '내용-1234',
    );
    expect(env.last('t1')).toMatchObject({ state: 'done', bytes: 11, total: 11 });
    env.queue.dispose();
  });

  it('SEC-11 Windows에서 쓸 수 없는 이름은 바꿔 저장하고, 경로 탈출 이름은 거부한다', async () => {
    const env = setup({ '/a': enc('x'), '/b': enc('y') });
    env.queue.enqueue(job('t1', '/a', 'what?.txt'));
    env.queue.enqueue(job('t2', '/b', '..'));
    await drain();
    expect([...(env.targets.get('C:/dl')?.keys() ?? [])]).toEqual(['what_.txt']);
    expect(env.last('t2')).toMatchObject({ state: 'failed', error: 'invalid-name' });
    env.queue.dispose();
  });

  it('F4.3 같은 이름이 있으면 묻고, 이름 변경은 고유한 이름으로, 건너뛰기는 skipped', async () => {
    const env = setup(
      { '/a': enc('new'), '/b': enc('new2') },
      { answers: [{ decision: 'rename' }, { decision: 'skip' }] },
    );
    env.targets.set('C:/dl', new Map([['a.txt', enc('old')]]));
    env.queue.enqueue(job('t1', '/a', 'a.txt'));
    await drain();
    env.queue.enqueue(job('t2', '/b', 'a.txt'));
    await drain();
    expect([...(env.targets.get('C:/dl')?.keys() ?? [])].sort()).toEqual(['a (1).txt', 'a.txt']);
    expect(env.last('t2')?.state).toBe('skipped');
    expect(env.asked).toEqual(['a.txt', 'a.txt']);
    env.queue.dispose();
  });

  it('F4.3b "모두 적용"을 고르면 이후 충돌은 묻지 않는다', async () => {
    const env = setup(
      { '/a': enc('1'), '/b': enc('2') },
      { answers: [{ decision: 'overwrite', applyAll: true }], concurrency: 1 },
    );
    env.targets.set(
      'C:/dl',
      new Map([
        ['x', enc('old')],
        ['y', enc('old')],
      ]),
    );
    env.queue.enqueue({ ...job('t1', '/a', 'x'), batchId: 'b1' });
    env.queue.enqueue({ ...job('t2', '/b', 'y'), batchId: 'b1' });
    await drain();
    expect(env.asked).toEqual(['x']);
    expect(new TextDecoder().decode(env.targets.get('C:/dl')?.get('y'))).toBe('2');
    env.queue.dispose();
  });

  it('동시에 최대 3개만 실행하고 나머지는 queued로 기다린다', async () => {
    const env = setup(
      Object.fromEntries(['/1', '/2', '/3', '/4'].map((p) => [p, enc('abcdefgh')])),
    );
    env.block();
    for (const n of ['1', '2', '3', '4']) env.queue.enqueue(job(`t${n}`, `/${n}`, n));
    await drain();
    expect(['t1', 't2', 't3', 't4'].map((id) => env.last(id)?.state)).toEqual([
      'running',
      'running',
      'running',
      'queued',
    ]);
    env.releaseAll();
    await drain(600);
    expect(env.last('t4')?.state).toBe('done');
    env.queue.dispose();
  });

  it('AC11 취소하면 부분 파일을 버리고 cancelled, 다른 전송은 계속된다', async () => {
    const env = setup({ '/big': enc('x'.repeat(400)), '/small': enc('ok') });
    env.block();
    env.queue.enqueue(job('big', '/big', 'big.bin'));
    env.queue.enqueue(job('small', '/small', 'small.txt'));
    await drain();
    env.releaseOne();
    await drain();
    env.queue.cancel('big');
    env.releaseAll();
    await drain(2000);
    expect(env.last('big')?.state).toBe('cancelled');
    expect(env.targets.get('C:/dl')?.has('big.bin')).toBe(false);
    expect(env.openSinks.size).toBe(0);
    expect(env.last('small')?.state).toBe('done');
    env.queue.dispose();
  });

  it('원본을 열 수 없으면 failed와 이유', async () => {
    const env = setup({});
    env.queue.enqueue(job('t1', '/nope', 'nope'));
    await drain();
    expect(env.last('t1')).toMatchObject({ state: 'failed', error: 'missing' });
    env.queue.dispose();
  });

  it('진행률은 250ms마다 한 번만 알린다(UI 부하 제한)', async () => {
    const env = setup({ '/a': enc('x'.repeat(40)) });
    env.queue.enqueue(job('t1', '/a', 'a'));
    await drain(600);
    const running = env.statuses.filter((s) => s.id === 't1' && s.state === 'running');
    expect(running.length).toBeLessThanOrEqual(2);
    expect(env.last('t1')).toMatchObject({ state: 'done', bytes: 40 });
    env.queue.dispose();
  });
});

describe('TransferQueue 충돌 범위(보안 리뷰 #8)', () => {
  it('"모두 적용"은 같은 배치·방향에만 쓴다', async () => {
    const env = setup(
      { '/a': enc('1'), '/b': enc('2') },
      {
        answers: [{ decision: 'overwrite', applyAll: true }, { decision: 'skip' }],
        concurrency: 1,
      },
    );
    env.targets.set(
      'C:/dl',
      new Map([
        ['x', enc('old')],
        ['y', enc('old')],
      ]),
    );
    env.queue.enqueue({ ...job('t1', '/a', 'x'), batchId: 'b1' });
    await drain();
    env.queue.enqueue({ ...job('t2', '/b', 'y'), batchId: 'b2' });
    await drain();
    expect(env.asked).toEqual(['x', 'y']);
    expect(env.last('t2')?.state).toBe('skipped');
    env.queue.dispose();
  });

  it('동시에 같은 이름으로 받는 두 작업은 서로 다른 이름을 쓴다', async () => {
    const env = setup(
      { '/a': enc('first'), '/b': enc('second') },
      { answers: [{ decision: 'rename' }] },
    );
    env.block();
    env.queue.enqueue(job('t1', '/a', 'same.txt'));
    env.queue.enqueue(job('t2', '/b', 'same.txt'));
    await drain();
    env.releaseAll();
    await drain(600);
    expect([...(env.targets.get('C:/dl')?.keys() ?? [])].sort()).toEqual([
      'same (1).txt',
      'same.txt',
    ]);
    env.queue.dispose();
  });
});
