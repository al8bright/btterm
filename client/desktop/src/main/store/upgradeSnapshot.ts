import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonFileStore } from './JsonFileStore';

const EXCLUDED = new Set(['snapshots', 'logs', 'app-state.json', 'app-state.json.bak']);

export interface UpgradeSnapshotOptions {
  dataDir: string;
  appVersion: string;
  now: number;
}

/**
 * 새 버전 첫 실행이면 마이그레이션 전에 데이터 폴더를 snapshots/<이전버전>-<시각>/ 에 복사한다(F6.10, AC25).
 */
export async function ensureUpgradeSnapshot(
  options: UpgradeSnapshotOptions,
): Promise<{ snapshot: string | null }> {
  const stateStore = new JsonFileStore(join(options.dataDir, 'app-state.json'));
  const state = await stateStore.read();
  const previous =
    state.source === 'none'
      ? null
      : ((state.data as { lastRunVersion?: string }).lastRunVersion ?? null);

  let snapshot: string | null = null;
  if (previous !== null && compareVersions(previous, options.appVersion) < 0) {
    snapshot = join(options.dataDir, 'snapshots', `${previous}-${options.now}`);
    await mkdir(snapshot, { recursive: true });
    for (const name of await readdir(options.dataDir)) {
      if (EXCLUDED.has(name)) continue;
      await cp(join(options.dataDir, name), join(snapshot, name), { recursive: true });
    }
  }

  if (previous !== options.appVersion) {
    await stateStore.write({ lastRunVersion: options.appVersion });
  }
  return { snapshot };
}

/** 0.x semver 비교(사전 릴리스 태그는 무시). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map(Number);
  const pb = b.split('-')[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
