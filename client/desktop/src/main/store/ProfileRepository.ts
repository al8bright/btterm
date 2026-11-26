import {
  emptyProfileStore,
  migrateStore,
  PROFILE_STORE_VERSION,
  ProfileStoreSchema,
  type Migration,
  type ProfileStore,
  type StoreData,
} from '@btterm/core';
import { JsonFileStore } from './JsonFileStore';

/** 프로필 저장소 마이그레이션 목록. 스키마를 바꾸면 여기에 단계를 추가한다(F6.3). */
export const PROFILE_MIGRATIONS: Migration[] = [];

/**
 * 서버·그룹·Identity·키 메타데이터 저장소(F6.2). 비밀 본문은 SecretVault에만 있다(SEC-1).
 * 읽을 때 마이그레이션·검증하고, 변경은 검증을 통과한 뒤에만 원자적으로 저장한다.
 */
export class ProfileRepository {
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly store: JsonFileStore,
    private state: ProfileStore,
    readonly recoveredFromBackup: boolean,
  ) {}

  static async open(
    path: string,
    migrations: readonly Migration[] = PROFILE_MIGRATIONS,
  ): Promise<ProfileRepository> {
    const store = new JsonFileStore(path);
    const read = await store.read();
    if (read.source === 'none') return new ProfileRepository(store, emptyProfileStore(), false);

    const migrated = migrateStore(read.data as StoreData, PROFILE_STORE_VERSION, migrations);
    const state = ProfileStoreSchema.parse(migrated.data);
    const recovered = read.source === 'backup';
    if (migrated.migrated || recovered) await store.write(state);
    return new ProfileRepository(store, state, recovered);
  }

  get current(): ProfileStore {
    return this.state;
  }

  /**
   * 변경은 하나씩 차례로 한다. 변경이 겹쳐도 앞의 결과 위에 다음 변경을 얹는다
   * (그렇지 않으면 둘 다 옛 상태에서 시작해 한쪽이 사라진다).
   */
  update(mutate: (store: ProfileStore) => ProfileStore): Promise<ProfileStore> {
    const run = this.#queue.then(async () => {
      const next = ProfileStoreSchema.parse(mutate(this.state));
      await this.store.write(next);
      this.state = next;
      return next;
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
