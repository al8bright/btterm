import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFileStore } from './JsonFileStore';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-store-'));
  file = join(dir, 'profiles.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonFileStore', () => {
  it('파일이 없으면 source=none', async () => {
    expect(await new JsonFileStore(file).read()).toEqual({ source: 'none' });
  });

  it('쓴 값을 그대로 읽는다', async () => {
    const store = new JsonFileStore(file);
    await store.write({ schemaVersion: 1, name: '한글' });
    expect(await store.read()).toEqual({
      source: 'main',
      data: { schemaVersion: 1, name: '한글' },
    });
  });

  it('두 번째 쓰기부터 직전 내용을 .bak으로 남긴다', async () => {
    const store = new JsonFileStore(file);
    await store.write({ v: 1 });
    await store.write({ v: 2 });
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8'))).toEqual({ v: 1 });
  });

  it('쓰기가 끝나면 임시 파일이 남지 않는다', async () => {
    const store = new JsonFileStore(file);
    await store.write({ v: 1 });
    expect((await readdir(dir)).filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('AC21 본 파일이 깨졌으면 .bak으로 복구하고 source=backup', async () => {
    const store = new JsonFileStore(file);
    await store.write({ v: 1 });
    await store.write({ v: 2 });
    await writeFile(file, '{"v": 2, "trunc', 'utf8');
    expect(await store.read()).toEqual({ source: 'backup', data: { v: 1 } });
  });

  it('AC21 쓰기 도중 중단돼 본 파일이 없고 임시 파일만 남아도 .bak을 읽는다', async () => {
    const store = new JsonFileStore(file);
    await store.write({ v: 1 });
    await store.write({ v: 2 });
    await rm(file);
    await writeFile(`${file}.tmp-crash`, '{"v": 3', 'utf8');
    expect(await store.read()).toEqual({ source: 'backup', data: { v: 1 } });
  });

  it('본 파일과 .bak이 모두 깨졌으면 corrupt 오류', async () => {
    await writeFile(file, 'x', 'utf8');
    await writeFile(`${file}.bak`, 'y', 'utf8');
    await expect(new JsonFileStore(file).read()).rejects.toThrow(/corrupt/);
  });
});
