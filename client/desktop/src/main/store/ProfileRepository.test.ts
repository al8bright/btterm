import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { upsertProfile, type Profile } from '@btterm/core';
import { ProfileRepository } from './ProfileRepository';

let dir: string;
let file: string;

const profile: Profile = {
  id: 'p1',
  groupId: null,
  name: 'web-01',
  host: '10.0.0.5',
  overrides: {},
  tags: [],
  updatedAt: 0,
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-repo-'));
  file = join(dir, 'profiles.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ProfileRepository', () => {
  it('파일이 없으면 빈 저장소로 시작한다', async () => {
    const repo = await ProfileRepository.open(file);
    expect(repo.current.profiles).toEqual([]);
    expect(repo.recoveredFromBackup).toBe(false);
  });

  it('update한 내용을 저장하고 다시 열어도 그대로다', async () => {
    const repo = await ProfileRepository.open(file);
    await repo.update((s) => upsertProfile(s, profile));
    const reopened = await ProfileRepository.open(file);
    expect(reopened.current.profiles.map((p) => p.name)).toEqual(['web-01']);
  });

  it('동시에 들어온 변경은 앞의 결과 위에 차례로 얹는다(겹친 사용자 편집)', async () => {
    const repo = await ProfileRepository.open(file);
    await Promise.all([
      repo.update((s) => upsertProfile(s, profile)),
      repo.update((s) => upsertProfile(s, { ...profile, id: 'p2' })),
    ]);
    expect(repo.current.profiles.map((p) => p.id)).toEqual(['p1', 'p2']);
    const again = await ProfileRepository.open(file);
    expect(again.current.profiles).toHaveLength(2);
  });

  it('스키마에 맞지 않는 변경은 저장하지 않고 거부한다', async () => {
    const repo = await ProfileRepository.open(file);
    await expect(
      repo.update((s) => ({ ...s, profiles: [{ ...profile, host: '' }] })),
    ).rejects.toThrow();
    expect(repo.current.profiles).toEqual([]);
  });

  it('AC21 본 파일이 깨졌으면 .bak에서 복구하고 복구 사실을 알린다', async () => {
    const repo = await ProfileRepository.open(file);
    await repo.update((s) => upsertProfile(s, profile));
    await repo.update((s) => upsertProfile(s, { ...profile, name: 'v2' }));
    await writeFile(file, '{"schemaVersion":1,', 'utf8');
    const reopened = await ProfileRepository.open(file);
    expect(reopened.recoveredFromBackup).toBe(true);
    expect(reopened.current.profiles[0]?.name).toBe('web-01');
  });

  it('AC22 마이그레이션이 일어나면 결과를 즉시 저장한다', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 0, items: [] }), 'utf8');
    const repo = await ProfileRepository.open(file, [
      {
        from: 0,
        to: 1,
        up: () => ({
          schemaVersion: 1,
          groups: [],
          identities: [],
          profiles: [],
          keys: [],
          credentials: [],
        }),
      },
    ]);
    expect(repo.current.schemaVersion).toBe(1);
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(1);
  });

  it('앱보다 새 스키마 파일은 열지 않는다', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 99 }), 'utf8');
    await expect(ProfileRepository.open(file)).rejects.toThrow(/newer-schema/);
  });
});
