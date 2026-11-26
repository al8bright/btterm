import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchFile } from './watchFile';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-watch-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('watchFile (F4.8 로컬 편집 저장 감지)', () => {
  it('덮어쓰기 저장과 "새 파일에 쓰고 이름 바꾸기" 저장을 모두 한 번씩 알린다', async () => {
    const path = join(dir, 'app.conf');
    await writeFile(path, 'v1');
    let changes = 0;
    const stop = watchFile(path, () => changes++);
    await wait(300);

    await writeFile(path, 'v2-longer');
    await wait(1200);
    expect(changes).toBe(1);

    await writeFile(join(dir, 'app.conf.tmp'), 'v3-from-editor');
    await rename(join(dir, 'app.conf.tmp'), path);
    await wait(1200);
    expect(changes).toBe(2);

    stop();
    await writeFile(path, 'after stop');
    await wait(1000);
    expect(changes).toBe(2);
  }, 10_000);
});
