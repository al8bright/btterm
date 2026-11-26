import { describe, expect, it } from 'vitest';
import { migrateStore, type Migration } from './migrations';

const v1ToV2: Migration = {
  from: 1,
  to: 2,
  up: (data) => ({ ...data, schemaVersion: 2, renamed: true }),
};

describe('migrateStore', () => {
  it('현재 버전이면 그대로 돌려주고 migrated=false', () => {
    const result = migrateStore({ schemaVersion: 2 }, 2, [v1ToV2]);
    expect(result).toEqual({ data: { schemaVersion: 2 }, from: 2, to: 2, migrated: false });
  });

  it('AC22 이전 버전이면 단계별로 올리고 migrated=true', () => {
    const result = migrateStore({ schemaVersion: 1, a: 1 }, 2, [v1ToV2]);
    expect(result).toEqual({
      data: { schemaVersion: 2, a: 1, renamed: true },
      from: 1,
      to: 2,
      migrated: true,
    });
  });

  it('AC22 원본 객체는 바꾸지 않는다', () => {
    const original = { schemaVersion: 1 };
    migrateStore(original, 2, [v1ToV2]);
    expect(original).toEqual({ schemaVersion: 1 });
  });

  it('앱보다 새 버전 파일이면 newer-schema 오류', () => {
    expect(() => migrateStore({ schemaVersion: 3 }, 2, [v1ToV2])).toThrow(/newer-schema/);
  });

  it('중간 단계 마이그레이션이 없으면 오류', () => {
    expect(() => migrateStore({ schemaVersion: 1 }, 3, [v1ToV2])).toThrow(/2 → 3/);
  });

  it('schemaVersion이 없으면 invalid-store 오류', () => {
    expect(() => migrateStore({}, 1, [])).toThrow(/invalid-store/);
  });
});
