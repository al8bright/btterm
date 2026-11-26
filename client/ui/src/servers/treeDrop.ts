import {
  emptyProfileStore,
  groupChain,
  moveTreeItem,
  resolveEffectiveSettings,
  treeChildren,
  type ProfilesView,
  type TreeItemRef,
} from '@btterm/core';
import type { TreeRow } from './serverTree';

export type DropZone = 'before' | 'after' | 'inside';
type ItemRow = Exclude<TreeRow, { kind: 'section' }>;

/** 행 안 세로 위치(0~1)로 놓을 자리를 고른다(DESIGN §5.2). 그룹은 가운데 절반이 "안" */
export function dropZoneAt(row: ItemRow, ratio: number): DropZone {
  if (row.kind === 'profile') return ratio < 0.5 ? 'before' : 'after';
  if (ratio < 0.25) return 'before';
  return ratio > 0.75 ? 'after' : 'inside';
}

/**
 * 끌던 항목을 row의 zone에 놓을 때의 새 부모·위치(F1.2a). row가 없으면 최상위 맨 끝.
 * 위치는 끌던 항목을 뺀 형제 목록 기준이다(core moveTreeItem과 같은 기준).
 * 놓을 수 없거나 제자리면 null.
 */
export function dropTarget(
  view: ProfilesView,
  dragged: TreeItemRef,
  row: ItemRow | null,
  zone: DropZone,
): { parentId: string | null; index: number } | null {
  if (row?.kind === 'profile' && !row.inTree) return null;
  const parentId = !row ? null : zone === 'inside' ? row.id : row.parentId;
  if (
    dragged.kind === 'group' &&
    groupChain(parentId, view.groups).some((g) => g.id === dragged.id)
  )
    return null;

  const siblings = treeChildren(view, parentId);
  const current = siblings.findIndex((c) => c.kind === dragged.kind && c.id === dragged.id);
  let index = !row || zone === 'inside' ? siblings.length : row.index + (zone === 'after' ? 1 : 0);
  if (current >= 0 && current < index) index -= 1;
  if (current === index) return null;
  return { parentId, index };
}

/** 그룹에서 물려받으면 위험한 값: 다른 호스트로 인증 정보가 가거나 명령이 실행될 수 있다 */
const SENSITIVE = ['identityId', 'username', 'startupCommand'] as const;
const APP_DEFAULTS = { port: 22, keepaliveSec: 30 };

/**
 * 옮기면 어떤 서버의 접속 계정·인증·시작 명령이 바뀌는가(보안 리뷰 L1).
 * 그룹을 옮기면 그 아래 모든 서버를 본다.
 */
export function moveChangesInheritance(
  view: ProfilesView,
  item: TreeItemRef,
  parentId: string | null,
  index: number,
): boolean {
  const before = { ...emptyProfileStore(), groups: view.groups, profiles: view.profiles };
  const after = moveTreeItem(before, item, parentId, index);
  const effective = (tree: typeof before, profileId: string) => {
    const profile = tree.profiles.find((p) => p.id === profileId)!;
    return resolveEffectiveSettings(profile, groupChain(profile.groupId, tree.groups), APP_DEFAULTS)
      .values;
  };
  return view.profiles.some((p) => {
    const was = effective(before, p.id);
    const now = effective(after, p.id);
    return SENSITIVE.some((key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]));
  });
}
