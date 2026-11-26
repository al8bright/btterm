import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeObsoleteFiles } from './obsoleteFiles';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-obsolete-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('제거한 계정·동기화(F8)의 파일 정리', () => {
  it('데이터 폴더와 업그레이드 스냅샷에서 계정·동기화 파일(.bak 포함)만 지운다', async () => {
    const snap = join(dir, 'snapshots', '0.1.1-1');
    await mkdir(snap, { recursive: true });
    for (const base of [dir, snap]) {
      for (const name of [
        'account.json',
        'account.json.bak',
        'account-owner.json',
        'account-kdf.json',
        'sync-state.json',
        'sync-state.json.bak',
        'profiles.json',
        'vault.json',
      ]) {
        await writeFile(join(base, name), '{}');
      }
    }

    await removeObsoleteFiles(dir);

    expect((await readdir(dir)).sort()).toEqual(['profiles.json', 'snapshots', 'vault.json']);
    expect((await readdir(snap)).sort()).toEqual(['profiles.json', 'vault.json']);
  });

  it('파일이나 스냅샷 폴더가 없어도 실패하지 않는다', async () => {
    await expect(removeObsoleteFiles(dir)).resolves.toBeUndefined();
    await expect(removeObsoleteFiles(join(dir, 'missing'))).resolves.toBeUndefined();
  });
});
