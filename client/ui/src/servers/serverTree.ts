import {
  groupChain,
  resolveEffectiveSettings,
  treeChildren,
  type IconRef,
  type Profile,
  type ProfilesView,
} from '@btterm/core';

export type TreeRow =
  | {
      kind: 'section';
      id: 'pinned' | 'all';
      label: 'pinned' | 'all';
      level: 1;
    }
  | {
      kind: 'group';
      id: string;
      label: string;
      level: number;
      expanded: boolean;
      icon?: IconRef;
      /** 폴더 아이콘 색: 이 그룹(없으면 상위 그룹)이 정한 아이콘 색 */
      color?: string;
      /** 끌어 놓기용 위치(F1.2a): 부모 그룹과 그 안 순번 */
      parentId: string | null;
      index: number;
    }
  | {
      kind: 'profile';
      /** 같은 서버가 고정·트리에 여러 번 나올 수 있어 행 키는 따로 둔다 */
      key: string;
      id: string;
      label: string;
      host: string;
      level: number;
      icon?: IconRef;
      parentId: string | null;
      index: number;
      /** 전체 트리 행이면 true. 고정·검색 행은 끌 수만 있고 놓을 곳이 아니다 */
      inTree: boolean;
    };

interface TreeOptions {
  query: string;
  collapsed: ReadonlySet<string>;
}

const APP_DEFAULTS = { port: 22, keepaliveSec: 30 };

/** 사이드바 행 목록(F1.2, F5.1). 검색어가 있으면 퍼지 일치한 서버만 평평하게. */
export function buildServerTree(view: ProfilesView, options: TreeOptions): TreeRow[] {
  const query = options.query.trim().toLowerCase();
  if (query) return searchRows(view, query);

  const rows: TreeRow[] = [];
  const pinned = view.profiles.filter((p) => p.pinned).sort(byName);
  if (pinned.length > 0) {
    rows.push(section('pinned'), ...pinned.map((p) => profileRow(view, p, 1, 'pin', 0)));
  }
  if (rows.length > 0) rows.push(section('all'));
  appendLevel(view, null, 1, options.collapsed, rows);
  return rows;
}

function appendLevel(
  view: ProfilesView,
  parentId: string | null,
  level: number,
  collapsed: ReadonlySet<string>,
  rows: TreeRow[],
): void {
  treeChildren(view, parentId).forEach((child, index) => {
    if (child.kind === 'profile') {
      const profile = view.profiles.find((p) => p.id === child.id);
      if (profile) rows.push(profileRow(view, profile, level, 'tree', index));
      return;
    }
    const group = view.groups.find((g) => g.id === child.id);
    if (!group) return;
    const expanded = !collapsed.has(group.id);
    const icon = groupIcon(view, group.id);
    rows.push({
      kind: 'group',
      id: group.id,
      label: group.name,
      level,
      expanded,
      ...(icon ? { icon } : {}),
      ...(icon?.kind === 'builtin' && icon.color ? { color: icon.color } : {}),
      parentId,
      index,
    });
    if (expanded) appendLevel(view, group.id, level + 1, collapsed, rows);
  });
}

/**
 * 빠른 연결 칸의 서버 목록(F5.1, 결정 UX3). 빈 칸이면 고정 먼저·이름순, 글자를 치면 퍼지 검색.
 * `@`를 치기 시작하면 직접 주소를 쓰는 중이므로 목록을 비운다.
 */
export function quickMatches(view: ProfilesView, query: string, limit = 8): Profile[] {
  const text = query.trim().toLowerCase();
  if (text.includes('@')) return [];
  if (!text) {
    return [...view.profiles]
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || byName(a, b))
      .slice(0, limit);
  }
  return view.profiles
    .map((profile) => ({ profile, score: matchScore(profile, text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || byName(a.profile, b.profile))
    .slice(0, limit)
    .map(({ profile }) => profile);
}

export interface ServerCard {
  id: string;
  name: string;
  host: string;
  icon: IconRef | undefined;
}

/** 빈 칸 서버 카드(F1.2b, 결정 DF4): 고정 서버(이름순) → 최근 접속(최근 먼저), 최대 limit개 */
export function serverCards(view: ProfilesView, limit = 8): ServerCard[] {
  const pinned = view.profiles.filter((p) => p.pinned).sort(byName);
  const recent = view.profiles
    .filter((p) => !p.pinned && p.lastConnectedAt !== undefined)
    .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0));
  return [...pinned, ...recent].slice(0, limit).map((profile) => ({
    id: profile.id,
    name: profile.name,
    host: profile.host,
    icon: profileIcon(view, profile),
  }));
}

function searchRows(view: ProfilesView, query: string): TreeRow[] {
  return view.profiles
    .map((profile) => ({ profile, score: matchScore(profile, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || byName(a.profile, b.profile))
    .map(({ profile }) => profileRow(view, profile, 1, 'search', 0));
}

/** 2 = 부분 문자열 일치, 1 = 순서대로 들어 있음(퍼지), 0 = 불일치 */
function matchScore(profile: Profile, query: string): number {
  const fields = [profile.name, profile.host, ...profile.tags].map((f) => f.toLowerCase());
  if (fields.some((f) => f.includes(query))) return 2;
  if (fields.some((f) => isSubsequence(query, f))) return 1;
  return 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let next = 0;
  for (const ch of haystack) {
    if (ch === needle[next]) next++;
    if (next === needle.length) return true;
  }
  return false;
}

function profileRow(
  view: ProfilesView,
  profile: Profile,
  level: number,
  place: 'pin' | 'tree' | 'search',
  index: number,
): TreeRow {
  const icon = profileIcon(view, profile);
  return {
    kind: 'profile',
    key: `${place}:${profile.id}`,
    id: profile.id,
    label: profile.name,
    host: profile.host,
    level,
    ...(icon ? { icon } : {}),
    parentId: profile.groupId,
    index,
    inTree: place === 'tree',
  };
}

/** 서버 → 그룹 → 상위 그룹 순으로 정한 아이콘 */
export function profileIcon(view: ProfilesView, profile: Profile): IconRef | undefined {
  return resolveEffectiveSettings(profile, groupChain(profile.groupId, view.groups), APP_DEFAULTS)
    .values.icon;
}

function groupIcon(view: ProfilesView, groupId: string): IconRef | undefined {
  return groupChain(groupId, view.groups).find((g) => g.defaults.icon)?.defaults.icon;
}

function section(id: 'pinned' | 'all'): TreeRow {
  return { kind: 'section', id, label: id, level: 1 };
}

function byName(a: Profile, b: Profile): number {
  return a.name.localeCompare(b.name);
}
