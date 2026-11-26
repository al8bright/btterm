import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureUpgradeSnapshot } from './upgradeSnapshot';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'btterm-data-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const state = async () => JSON.parse(await readFile(join(dataDir, 'app-state.json'), 'utf8'));

describe('ensureUpgradeSnapshot', () => {
  it('첫 실행이면 스냅샷 없이 현재 버전만 기록한다', async () => {
    const result = await ensureUpgradeSnapshot({ dataDir, appVersion: '0.1.0', now: 1000 });
    expect(result).toEqual({ snapshot: null });
    expect((await state()).lastRunVersion).toBe('0.1.0');
  });

  it('같은 버전 재실행이면 스냅샷을 만들지 않는다', async () => {
    await ensureUpgradeSnapshot({ dataDir, appVersion: '0.1.0', now: 1000 });
    expect(await ensureUpgradeSnapshot({ dataDir, appVersion: '0.1.0', now: 2000 })).toEqual({
      snapshot: null,
    });
  });

  it('AC25 새 버전 첫 실행이면 마이그레이션 전에 데이터 폴더를 스냅샷한다', async () => {
    await ensureUpgradeSnapshot({ dataDir, appVersion: '0.1.0', now: 1000 });
    await writeFile(join(dataDir, 'profiles.json'), '{"schemaVersion":1}', 'utf8');
    await mkdir(join(dataDir, 'logs'));
    await writeFile(join(dataDir, 'logs', 'app.log'), 'big log', 'utf8');

    const result = await ensureUpgradeSnapshot({ dataDir, appVersion: '0.2.0', now: 5000 });

    expect(result.snapshot).toBe(join(dataDir, 'snapshots', '0.1.0-5000'));
    const copied = await readdir(result.snapshot!);
    expect(copied).toContain('profiles.json');
    expect(copied).not.toContain('logs');
    expect(copied).not.toContain('snapshots');
    expect((await state()).lastRunVersion).toBe('0.2.0');
  });
});
