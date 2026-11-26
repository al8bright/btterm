import type { Group, Profile, ProfileStore } from './model';
import { groupChain } from './settings';

/** 서버 트리의 한 항목(그룹 또는 서버) */
export interface TreeItemRef {
  kind: 'group' | 'profile';
  id: string;
}

type Tree = Pick<ProfileStore, 'groups' | 'profiles'>;

interface Child extends TreeItemRef {
  order: number | undefined;
  name: string;
}

/**
 * 한 부모 아래 자식 순서(F1.2a, DND1). 그룹과 서버가 한 순서를 공유한다.
 * order(없으면 맨 뒤) → 그룹 먼저 → 이름.
 */
export function treeChildren(tree: Tree, parentId: string | null): TreeItemRef[] {
  const children: Child[] = [
    ...tree.groups.filter((g) => g.parentId === parentId).map((g) => child('group', g)),
    ...tree.profiles.filter((p) => p.groupId === parentId).map((p) => child('profile', p)),
  ];
  return children.sort(compare).map(({ kind, id }) => ({ kind, id }));
}

/**
 * 항목을 새 부모의 index 자리로 옮기고 그 단계의 순서를 0부터 다시 매긴다(DND3).
 * 그룹을 자기 자신·하위로 옮기거나 대상·부모가 없으면 원본을 그대로 돌려준다(DND4).
 */
export function moveTreeItem(
  store: ProfileStore,
  item: TreeItemRef,
  parentId: string | null,
  index: number,
): ProfileStore {
  const exists =
    item.kind === 'group'
      ? store.groups.some((g) => g.id === item.id)
      : store.profiles.some((p) => p.id === item.id);
  if (!exists) return store;
  if (parentId !== null && !store.groups.some((g) => g.id === parentId)) return store;
  if (item.kind === 'group' && isSelfOrDescendant(store.groups, item.id, parentId)) return store;

  const siblings = treeChildren(store, parentId).filter(
    (c) => !(c.kind === item.kind && c.id === item.id),
  );
  const at = Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, item);
  const orderOf = new Map(siblings.map((c, i) => [`${c.kind}:${c.id}`, i]));
  const placed = (kind: TreeItemRef['kind'], id: string) => orderOf.get(`${kind}:${id}`);

  const next: ProfileStore = {
    ...store,
    groups: store.groups.map((g) => {
      const order = placed('group', g.id);
      if (order === undefined) return g;
      return { ...g, order, ...(g.id === item.id ? { parentId } : {}) };
    }),
    profiles: store.profiles.map((p) => {
      const order = placed('profile', p.id);
      if (order === undefined) return p;
      return { ...p, order, ...(p.id === item.id ? { groupId: parentId } : {}) };
    }),
  };
  // 위 검사가 회귀해도 순환을 저장하지 않게 한 번 더 막는다(보안 리뷰 L2). 순환이면 예외.
  if (item.kind === 'group') groupChain(item.id, next.groups);
  return next;
}

function child(kind: 'group', item: Group): Child;
function child(kind: 'profile', item: Profile): Child;
function child(kind: TreeItemRef['kind'], item: Group | Profile): Child {
  return { kind, id: item.id, order: item.order, name: item.name };
}

function compare(a: Child, b: Child): number {
  const byOrder = (a.order ?? Infinity) - (b.order ?? Infinity);
  if (byOrder !== 0 && !Number.isNaN(byOrder)) return byOrder;
  if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** target이 groupId 자신이거나 그 하위 그룹인가 */
function isSelfOrDescendant(
  groups: readonly Group[],
  groupId: string,
  target: string | null,
): boolean {
  const seen = new Set<string>();
  for (let current = target; current !== null && !seen.has(current);) {
    if (current === groupId) return true;
    seen.add(current);
    current = groups.find((g) => g.id === current)?.parentId ?? null;
  }
  return false;
}
