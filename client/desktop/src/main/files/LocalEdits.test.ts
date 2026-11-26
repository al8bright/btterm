import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WebContents } from 'electron';
import type { MainToRendererEvent, TransferJob } from '@btterm/core';
import { LocalEdits } from './LocalEdits';

const fakeSender = () => ({ isDestroyed: () => false }) as unknown as WebContents;
const ROOT = join('C:', 'data', 'edit');

function setup(
  options: {
    transferState?: 'done' | 'failed';
    openOk?: boolean;
    isFile?: boolean;
    duringTransfer?: () => Promise<void>;
  } = {},
) {
  const owner = fakeSender();
  const other = fakeSender();
  const jobs: Array<Omit<TransferJob, 'id' | 'batchId'>> = [];
  const opened: string[] = [];
  const removed: string[] = [];
  const made: string[] = [];
  const watchers = new Map<string, () => void>();
  const unwatched: string[] = [];
  const sent: MainToRendererEvent[] = [];
  let n = 0;
  const edits = new LocalEdits({
    tempRoot: ROOT,
    platform: 'windows',
    ids: () => `e${++n}`,
    transfer: async (_sender, job) => {
      jobs.push(job);
      await options.duringTransfer?.();
      return { state: options.transferState ?? 'done' };
    },
    isFile: async () => options.isFile ?? true,
    openPath: async (path) => {
      opened.push(path);
      return options.openOk ?? true;
    },
    watch: (path, onChange) => {
      watchers.set(path, onChange);
      return () => unwatched.push(path);
    },
    makeDir: async (path) => {
      made.push(path);
    },
    remove: async (path) => {
      removed.push(path);
    },
    send: (_sender, event) => sent.push(event),
  });
  return { edits, owner, other, jobs, opened, removed, made, watchers, unwatched, sent };
}

describe('원격 파일 로컬 편집 (F4.8, 결정 TR3)', () => {
  it('임시 폴더로 받아 기본 앱으로 열고, 저장을 감시한다', async () => {
    const env = setup();
    const result = await env.edits.open(env.owner, 's1', '/etc/nginx/app.conf');
    expect(result).toEqual({ ok: true, editId: 'e1' });
    const dir = join(ROOT, 'e1');
    expect(env.made).toEqual([dir]);
    expect(env.jobs).toEqual([
      {
        sessionId: 's1',
        direction: 'download',
        sourcePath: '/etc/nginx/app.conf',
        targetDir: dir,
        name: 'app.conf',
      },
    ]);
    expect(env.opened).toEqual([join(dir, 'app.conf')]);
    expect([...env.watchers.keys()]).toEqual([join(dir, 'app.conf')]);
  });

  it('SEC-11 실행 가능한 파일은 받지도 열지도 않는다', async () => {
    const env = setup();
    expect(await env.edits.open(env.owner, 's1', '/srv/tool.exe')).toEqual({
      ok: false,
      error: 'blocked-type',
    });
    expect(env.jobs).toEqual([]);
    expect(env.opened).toEqual([]);
  });

  it('받기·열기에 실패하면 임시 폴더를 지우고 이유를 돌려준다', async () => {
    const failed = setup({ transferState: 'failed' });
    expect(await failed.edits.open(failed.owner, 's1', '/a.txt')).toEqual({
      ok: false,
      error: 'download-failed',
    });
    expect(failed.removed).toEqual([join(ROOT, 'e1')]);

    const noApp = setup({ openOk: false });
    expect(await noApp.edits.open(noApp.owner, 's1', '/a.txt')).toEqual({
      ok: false,
      error: 'no-app',
    });
    expect(noApp.removed).toEqual([join(ROOT, 'e1')]);
  });

  it('받은 것이 일반 파일이 아니면(폴더·링크) 열지 않는다(보안 리뷰 M1)', async () => {
    const env = setup({ isFile: false });
    expect(await env.edits.open(env.owner, 's1', '/srv/site')).toEqual({
      ok: false,
      error: 'not-a-file',
    });
    expect(env.opened).toEqual([]);
    expect(env.removed).toEqual([join(ROOT, 'e1')]);
  });

  it('받는 동안 탭이 닫히면 열지도 감시하지도 않는다(보안 리뷰 L3)', async () => {
    const holder: { edits?: LocalEdits } = {};
    const env = setup({ duringTransfer: () => holder.edits!.closeSession('s1') });
    holder.edits = env.edits;
    expect(await env.edits.open(env.owner, 's1', '/a.txt')).toEqual({
      ok: false,
      error: 'closed',
    });
    expect(env.opened).toEqual([]);
    expect(env.watchers.size).toBe(0);
    expect(env.removed).toEqual([join(ROOT, 'e1')]);
  });

  it('저장하면 연 창에 바뀜을 알리고, 업로드는 확인 없이 원래 자리에 바꿔 넣는다', async () => {
    const env = setup();
    await env.edits.open(env.owner, 's1', '/etc/nginx/app.conf');
    env.watchers.get(join(ROOT, 'e1', 'app.conf'))!();
    expect(env.sent).toEqual([
      { type: 'files.editChanged', editId: 'e1', sessionId: 's1', name: 'app.conf' },
    ]);

    expect(await env.edits.upload(env.other, 'e1')).toEqual({ ok: false, error: 'not-found' });
    expect(await env.edits.upload(env.owner, 'e1')).toEqual({ ok: true });
    expect(env.jobs.at(-1)).toEqual({
      sessionId: 's1',
      direction: 'upload',
      sourcePath: join(ROOT, 'e1', 'app.conf'),
      targetDir: '/etc/nginx',
      name: 'app.conf',
      overwrite: true,
    });
  });

  it('탭을 닫으면 그 세션의 감시를 멈추고 임시 파일을 지운다', async () => {
    const env = setup();
    await env.edits.open(env.owner, 's1', '/a.txt');
    await env.edits.open(env.owner, 's2', '/b.txt');
    await env.edits.closeSession('s1');
    expect(env.unwatched).toEqual([join(ROOT, 'e1', 'a.txt')]);
    expect(env.removed).toEqual([join(ROOT, 'e1')]);
    expect(await env.edits.upload(env.owner, 'e1')).toEqual({ ok: false, error: 'not-found' });
  });
});
