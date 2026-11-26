import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 제거한 계정·동기화(F8, 2026-11-26)가 데이터 폴더에 남긴 파일. account.json에는 safeStorage로 감싼
 * 계정 키·토큰이 들어 있어, 쓰지 않는 자격 증명이 남지 않게 지운다.
 */
const OBSOLETE = ['account.json', 'account-owner.json', 'account-kdf.json', 'sync-state.json'];

/** 데이터 폴더와 업그레이드 스냅샷(snapshots/*)에서 지운다. 없으면 아무것도 하지 않는다 */
export async function removeObsoleteFiles(dataDir: string): Promise<void> {
  const snapshots = join(dataDir, 'snapshots');
  const dirs = [dataDir, ...(await subdirs(snapshots)).map((name) => join(snapshots, name))];
  for (const dir of dirs) {
    for (const name of OBSOLETE) {
      await rm(join(dir, name), { force: true });
      await rm(join(dir, `${name}.bak`), { force: true });
    }
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
