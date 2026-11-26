export type StoreData = Record<string, unknown> & { schemaVersion?: unknown };

export interface Migration {
  from: number;
  to: number;
  up: (data: StoreData) => StoreData;
}

export interface MigrationResult {
  data: StoreData;
  from: number;
  to: number;
  migrated: boolean;
}

/**
 * 저장 파일을 현재 스키마 버전까지 단계별로 올린다(F6.3, AC22).
 * 앱보다 새 버전 파일은 건드리지 않고 newer-schema 오류를 낸다.
 */
export function migrateStore(
  raw: StoreData,
  currentVersion: number,
  migrations: readonly Migration[],
): MigrationResult {
  const from = raw.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from)) {
    throw new Error('invalid-store: schemaVersion이 없습니다');
  }
  if (from > currentVersion) {
    throw new Error(`newer-schema: 파일 ${from} > 앱 ${currentVersion}`);
  }
  let data = structuredClone(raw);
  for (let version = from; version < currentVersion; version++) {
    const step = migrations.find((m) => m.from === version);
    if (!step || step.to !== version + 1) {
      throw new Error(`마이그레이션 없음: ${version} → ${version + 1}`);
    }
    data = step.up(data);
  }
  return { data, from, to: currentVersion, migrated: from !== currentVersion };
}
