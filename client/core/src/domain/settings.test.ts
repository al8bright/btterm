import { describe, expect, it } from 'vitest';
import {
  groupChain,
  resolveEffectiveSettings,
  serverStatsEnabled,
  tabColorOf,
  type AppDefaults,
} from './settings';
import type { Group, Profile } from './model';

const appDefaults: AppDefaults = { port: 22, keepaliveSec: 30 };

const prod: Group = {
  id: 'g-prod',
  parentId: null,
  name: 'Prod',
  order: 0,
  defaults: {
    port: 2222,
    identityId: 'id-ubuntu-key',
    icon: { kind: 'builtin', name: 'database' },
  },
};
const prodWeb: Group = {
  id: 'g-prod-web',
  parentId: 'g-prod',
  name: 'Web',
  order: 0,
  defaults: { keepaliveSec: 15 },
};

const profile = (overrides: Profile['overrides'], groupId: string | null = 'g-prod'): Profile => ({
  id: 'p1',
  groupId,
  name: 'web-01',
  host: '10.0.0.5',
  overrides,
  tags: [],
  updatedAt: 0,
});

describe('groupChain', () => {
  it('가까운 그룹부터 조상 순서로 돌려준다', () => {
    expect(groupChain('g-prod-web', [prod, prodWeb]).map((g) => g.id)).toEqual([
      'g-prod-web',
      'g-prod',
    ]);
  });

  it('그룹이 없으면 빈 배열', () => {
    expect(groupChain(null, [prod])).toEqual([]);
  });

  it('부모 순환이 있으면 예외', () => {
    const a: Group = { ...prod, id: 'a', parentId: 'b' };
    const b: Group = { ...prod, id: 'b', parentId: 'a' };
    expect(() => groupChain('a', [a, b])).toThrow(/순환/);
  });
});

describe('resolveEffectiveSettings', () => {
  it('AC23 프로필이 port를 지정하지 않으면 그룹 값을, 지정하면 자기 값을 쓴다', () => {
    const chain = groupChain('g-prod', [prod]);
    const a = resolveEffectiveSettings(profile({}), chain, appDefaults);
    const b = resolveEffectiveSettings(profile({ port: 22 }), chain, appDefaults);
    expect([a.values.port, a.values.identityId]).toEqual([2222, 'id-ubuntu-key']);
    expect([b.values.port, b.values.identityId]).toEqual([22, 'id-ubuntu-key']);
  });

  it('값마다 어디서 왔는지 출처를 알려준다', () => {
    const chain = groupChain('g-prod-web', [prod, prodWeb]);
    const result = resolveEffectiveSettings(
      profile({ port: 22 }, 'g-prod-web'),
      chain,
      appDefaults,
    );
    expect(result.sources.port).toBe('profile');
    expect(result.sources.keepaliveSec).toBe('g-prod-web');
    expect(result.sources.identityId).toBe('g-prod');
  });

  it('어디에도 없으면 앱 기본값을 쓴다', () => {
    const result = resolveEffectiveSettings(profile({}, null), [], appDefaults);
    expect(result.values.port).toBe(22);
    expect(result.sources.port).toBe('app');
    expect(result.values.identityId).toBeUndefined();
  });

  it('AC29 그룹 아이콘을 상속하고, 재정의한 프로필만 자기 아이콘을 쓴다', () => {
    const chain = groupChain('g-prod', [prod]);
    const inherited = resolveEffectiveSettings(profile({}), chain, appDefaults);
    const overridden = resolveEffectiveSettings(
      profile({ icon: { kind: 'builtin', name: 'web' } }),
      chain,
      appDefaults,
    );
    expect(inherited.values.icon).toEqual({ kind: 'builtin', name: 'database' });
    expect(overridden.values.icon).toEqual({ kind: 'builtin', name: 'web' });
  });
});

describe('tabColorOf (F3.1 탭 색)', () => {
  const colored: Group = { ...prod, defaults: { ...prod.defaults, tabColor: 'red' } };
  it('서버 값 → 가까운 그룹 → 조상 그룹 순, 없으면 없음. 빠른 연결도 없음', () => {
    expect(tabColorOf(profile({ tabColor: 'green' }, 'g-prod-web'), [colored, prodWeb])).toBe(
      'green',
    );
    expect(tabColorOf(profile({}, 'g-prod-web'), [colored, prodWeb])).toBe('red');
    expect(tabColorOf(profile({}, null), [colored])).toBeUndefined();
    expect(tabColorOf(undefined, [colored])).toBeUndefined();
  });
});

describe('serverStatsEnabled (F3.18, ST10)', () => {
  it('빠른 연결(프로필 없음)은 켠다', () => {
    expect(serverStatsEnabled(undefined, [])).toBe(true);
  });

  it('정하지 않으면 production·prod 태그 서버만 끈다', () => {
    expect(serverStatsEnabled(profile({}, null), [])).toBe(true);
    expect(serverStatsEnabled({ ...profile({}, null), tags: ['Production'] }, [])).toBe(false);
    expect(serverStatsEnabled({ ...profile({}, null), tags: ['web', 'prod'] }, [])).toBe(false);
    expect(serverStatsEnabled({ ...profile({}, null), tags: ['products'] }, [])).toBe(true);
  });

  it('서버 값이 그룹 값보다, 그룹 값이 태그 기본값보다 앞선다', () => {
    const quiet: Group = { ...prod, defaults: { serverStats: false } };
    expect(serverStatsEnabled(profile({}, 'g-prod'), [quiet])).toBe(false);
    expect(serverStatsEnabled(profile({ serverStats: true }, 'g-prod'), [quiet])).toBe(true);
    expect(
      serverStatsEnabled({ ...profile({ serverStats: true }, null), tags: ['production'] }, []),
    ).toBe(true);
  });
});
