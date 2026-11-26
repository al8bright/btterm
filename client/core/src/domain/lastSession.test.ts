import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, applySettingsPatch, defaultAppSettings } from './appSettings';
import { countSavedTabs, SavedNodeSchema, type SavedNode } from './lastSession';

const saved: SavedNode = {
  kind: 'split',
  axis: 'row',
  sizes: [0.6, 0.4],
  children: [
    {
      kind: 'group',
      tabs: [{ profileId: 'p1' }, { quick: { host: 'h', port: 22, username: 'a' } }],
    },
    { kind: 'group', tabs: [{ profileId: 'p2' }] },
  ],
};

describe('재시작 시 탭 복원 저장 형식 (F6.9, 결정 DF8)', () => {
  it('칸 배치와 탭(프로필 id 또는 빠른 연결 주소)을 담는다. 비밀은 없다', () => {
    expect(SavedNodeSchema.safeParse(saved).success).toBe(true);
    expect(countSavedTabs(saved)).toBe(3);
    expect(JSON.stringify(saved)).not.toMatch(/password|secret/i);
  });

  it('설정 파일 선택 필드. 패치로 저장하고 null이면 지운다', () => {
    const next = applySettingsPatch(defaultAppSettings(), { lastSession: saved });
    expect(next.lastSession).toEqual(saved);
    expect(applySettingsPatch(next, { ui: { sidebarOpen: false } }).lastSession).toEqual(saved);
    expect(applySettingsPatch(next, { lastSession: null })).not.toHaveProperty('lastSession');
  });

  it('잘못된 값은 그 필드만 버린다(나머지 설정은 지킨다)', () => {
    const parsed = AppSettingsSchema.parse({
      ...defaultAppSettings(),
      lastSession: { kind: 'group', tabs: [{ quick: { host: '', port: 0, username: 'a' } }] },
    });
    expect(parsed.lastSession).toBeUndefined();
  });

  it('칸은 최대 8개, 칸마다 탭 최대 50개', () => {
    const groups = Array.from({ length: 9 }, () => ({ kind: 'group', tabs: [{ profileId: 'p' }] }));
    expect(
      SavedNodeSchema.safeParse({ kind: 'split', axis: 'row', children: groups }).success,
    ).toBe(false);
  });
});
