import { describe, expect, it } from 'vitest';
import { AppSettingsPatchSchema, AppSettingsSchema, defaultAppSettings } from './appSettings';

describe('예전 설정 파일 호환 (F6.3)', () => {
  it('계정 자동 잠금(accountLock)이 남은 예전 파일도 읽고, 그 값만 버린다', () => {
    const parsed = AppSettingsSchema.parse({
      ...defaultAppSettings(),
      accountLock: { idleMinutes: 15, onScreenLock: true },
    });
    expect(parsed).toEqual(defaultAppSettings());
    expect(
      AppSettingsPatchSchema.parse({ accountLock: { idleMinutes: 15, onScreenLock: true } }),
    ).toEqual({});
  });
});
