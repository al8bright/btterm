import type { Group, HostDefaults, Profile } from './model';

export type AppDefaults = Omit<HostDefaults, 'port' | 'keepaliveSec'> & {
  port: number;
  keepaliveSec: number;
};

/** 값의 출처: 프로필 자신, 그룹 ID, 앱 기본값. "상속됨: Prod" 표시에 쓴다(DESIGN §5.8). */
export type SettingSource = 'profile' | 'app' | string;

export interface EffectiveSettings {
  values: AppDefaults;
  sources: Partial<Record<keyof HostDefaults, SettingSource>>;
}

/** groupId에서 시작해 조상 방향으로 그룹을 모은다(가까운 그룹이 먼저). */
export function groupChain(groupId: string | null, groups: readonly Group[]): Group[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const chain: Group[] = [];
  const seen = new Set<string>();
  for (let id = groupId; id !== null;) {
    if (seen.has(id)) throw new Error(`그룹 부모 순환: ${[...seen, id].join(' → ')}`);
    seen.add(id);
    const group = byId.get(id);
    if (!group) break;
    chain.push(group);
    id = group.parentId;
  }
  return chain;
}

/** 프로필 → 가까운 그룹 → 조상 그룹 → 앱 기본값 순으로 값을 정한다(D13, AC23). */
export function resolveEffectiveSettings(
  profile: Profile,
  chain: readonly Group[],
  appDefaults: AppDefaults,
): EffectiveSettings {
  const layers: Array<[SettingSource, HostDefaults]> = [
    ['profile', profile.overrides],
    ...chain.map((g): [SettingSource, HostDefaults] => [g.id, g.defaults]),
    ['app', appDefaults],
  ];
  const values: Record<string, unknown> = {};
  const sources: Record<string, SettingSource> = {};
  for (const [source, layer] of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined || key in values) continue;
      values[key] = value;
      sources[key] = source;
    }
  }
  return { values: values as AppDefaults, sources };
}

/** 서버 → 가까운 그룹 → 조상 그룹 순으로 처음 정해진 값(앱 기본값 없음) */
function firstDefined<K extends keyof HostDefaults>(
  profile: Profile,
  groups: readonly Group[],
  key: K,
): HostDefaults[K] | undefined {
  const layers = [profile.overrides, ...groupChain(profile.groupId, groups).map((g) => g.defaults)];
  return layers.find((layer) => layer[key] !== undefined)?.[key];
}

/** 탭 색(F3.1). 빠른 연결(프로필 없음)은 색 없음 */
export function tabColorOf(
  profile: Profile | undefined,
  groups: readonly Group[],
): string | undefined {
  return profile ? firstDefined(profile, groups, 'tabColor') : undefined;
}

const PRODUCTION_TAG = /^prod(uction)?$/i;

/**
 * 서버 상태 줄을 켤지(F3.18, ST10). 서버 → 그룹 → 조상 그룹 값 순으로 정하고,
 * 아무 데도 없으면 production·prod 태그 서버만 끈다. 빠른 연결(프로필 없음)은 켠다.
 */
export function serverStatsEnabled(
  profile: Profile | undefined,
  groups: readonly Group[],
): boolean {
  if (!profile) return true;
  const chosen = firstDefined(profile, groups, 'serverStats');
  return chosen ?? !profile.tags.some((tag) => PRODUCTION_TAG.test(tag.trim()));
}
