import {
  AppSettingsSchema,
  applySettingsPatch,
  defaultAppSettings,
  type AppSettings,
  type AppSettingsPatch,
  type WindowState,
} from '@btterm/core';
import { JsonFileStore } from './JsonFileStore';

/**
 * 앱 설정 파일(F6.7). 읽을 수 없거나 형식이 다르면 기본값으로 시작하고,
 * 사용자가 설정을 바꿀 때만 저장한다(깨진 파일을 열자마자 덮어쓰지 않는다).
 * 쓰기는 하나씩 차례로 한다(창 상태 저장과 설정 변경이 겹쳐도 둘 다 남게).
 */
export class SettingsRepository {
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly store: JsonFileStore,
    private state: AppSettings,
    /** 파일이 없었거나 제대로 읽었는지. 아니면 자동 저장(창 상태)으로 원본을 덮어쓰지 않는다 */
    private readonly loadedOk: boolean,
  ) {}

  static async open(path: string): Promise<SettingsRepository> {
    const store = new JsonFileStore(path);
    const read = await store.read().catch(() => null);
    if (read === null) return new SettingsRepository(store, defaultAppSettings(), false);
    if (read.source === 'none') return new SettingsRepository(store, defaultAppSettings(), true);
    const parsed = AppSettingsSchema.safeParse(read.data);
    return parsed.success
      ? new SettingsRepository(store, parsed.data, true)
      : new SettingsRepository(store, defaultAppSettings(), false);
  }

  get current(): AppSettings {
    return this.state;
  }

  /**
   * 창 위치·크기(F6.7). main 전용 — renderer 패치 스키마에는 window가 없다(결정 DF2).
   * 종료 때마다 불리므로, 읽지 못한 파일은 덮어쓰지 않고 메모리에만 둔다(보안 리뷰 M1).
   */
  saveWindow(window: WindowState): Promise<void> {
    return this.#serial(async () => {
      const next = AppSettingsSchema.parse({ ...this.state, window });
      if (this.loadedOk) await this.store.write(next);
      this.state = next;
    });
  }

  update(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.updateWith(() => patch);
  }

  /**
   * 차례가 왔을 때의 최신 설정으로 패치를 만든다(먼저 대기 중인 변경을 덮지 않게,
   * 보안 리뷰 S-4 L3). null이면 바꾸지 않는다
   */
  updateWith(build: (current: AppSettings) => AppSettingsPatch | null): Promise<AppSettings> {
    return this.#serial(async () => {
      const patch = build(this.state);
      if (patch === null) return this.state;
      const next = AppSettingsSchema.parse(applySettingsPatch(this.state, patch));
      await this.store.write(next);
      this.state = next;
      return next;
    });
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
