import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLimitedFile } from './readLimited';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-limit-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readLimitedFile(보안 리뷰 #5)', () => {
  it('상한 이하 파일은 읽고, 넘으면 too-large, 폴더도 거부한다', async () => {
    await writeFile(join(dir, 'small'), 'abc');
    await writeFile(join(dir, 'big'), Buffer.alloc(2048));
    expect(new TextDecoder().decode(await readLimitedFile(join(dir, 'small'), 1024))).toBe('abc');
    await expect(readLimitedFile(join(dir, 'big'), 1024)).rejects.toMatchObject({
      code: 'too-large',
    });
    await expect(readLimitedFile(dir, 1024)).rejects.toMatchObject({ code: 'too-large' });
    await expect(readLimitedFile(join(dir, 'nope'), 1024)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
