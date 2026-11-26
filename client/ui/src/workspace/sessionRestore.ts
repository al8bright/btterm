import type { SavedNode, SavedTab } from '@btterm/core';
import type { GroupLayout, LayoutNode } from './groupLayout';

/** 저장에 필요한 탭 정보(저장된 서버 = 프로필 id, 빠른 연결 = 주소) */
interface TabRef {
  sessionId: string;
  profileId?: string | undefined;
  quick?: { host: string; port: number; username: string } | undefined;
}

/**
 * 지금 칸 배치와 탭을 저장 형식으로(F6.9, 결정 DF8). 다시 열 수 없는 탭은 빼고,
 * 비거나 하나만 남은 묶음은 접는다. 탭이 하나도 없으면 null.
 */
export function snapshotSession(layout: GroupLayout, tabs: readonly TabRef[]): SavedNode | null {
  const byId = new Map(tabs.map((tab) => [tab.sessionId, tab]));
  const walk = (node: LayoutNode): SavedNode | null => {
    if (node.kind === 'group') {
      const saved = node.tabs.flatMap((id): SavedTab[] => {
        const tab = byId.get(id);
        if (tab?.profileId) return [{ profileId: tab.profileId }];
        if (tab?.quick) return [{ quick: tab.quick }];
        return [];
      });
      return saved.length > 0 ? { kind: 'group', tabs: saved } : null;
    }
    const kept = node.children.map((child, i) => ({ node: walk(child), size: node.sizes?.[i] }));
    return collapse(node.axis, kept);
  };
  return walk(layout.root);
}

/** 여는 순서 = 칸 순서(왼쪽·위부터), 칸 안 탭 순서 */
export function savedTabsInOrder(node: SavedNode): SavedTab[] {
  return node.kind === 'group' ? node.tabs : node.children.flatMap(savedTabsInOrder);
}

/**
 * 연 세션 id(savedTabsInOrder 순서, 열지 못했으면 null)로 칸 배치를 되살린다.
 * 하나도 열지 못한 칸은 없애고, 하나도 없으면 null.
 */
export function rebuildLayout(
  saved: SavedNode,
  opened: readonly (string | null)[],
  newId: () => string,
): GroupLayout | null {
  let next = 0;
  const walk = (node: SavedNode): LayoutNode | null => {
    if (node.kind === 'group') {
      const tabs = node.tabs.flatMap(() => {
        const id = opened[next++];
        return id ? [id] : [];
      });
      return tabs.length > 0 ? { kind: 'group', id: newId(), tabs, active: tabs.at(-1)! } : null;
    }
    const kept = node.children.map((child, i) => ({ node: walk(child), size: node.sizes?.[i] }));
    return collapse(node.axis, kept, newId);
  };
  const root = walk(saved);
  if (!root) return null;
  const first = (n: LayoutNode): string => (n.kind === 'group' ? n.id : first(n.children[0]!));
  return { root, focused: first(root) };
}

type Axis = 'row' | 'column';

/** 빈 자식을 빼고 비율을 다시 맞춘다. 하나만 남으면 그 자식 */
function collapse(
  axis: Axis,
  kept: Array<{ node: SavedNode | null; size: number | undefined }>,
): SavedNode | null;
function collapse(
  axis: Axis,
  kept: Array<{ node: LayoutNode | null; size: number | undefined }>,
  newId: () => string,
): LayoutNode | null;
function collapse(
  axis: Axis,
  kept: Array<{ node: SavedNode | LayoutNode | null; size: number | undefined }>,
  newId?: () => string,
): SavedNode | LayoutNode | null {
  const live = kept.filter((k): k is { node: SavedNode | LayoutNode; size: number | undefined } =>
    Boolean(k.node),
  );
  if (live.length === 0) return null;
  if (live.length === 1) return live[0]!.node;
  const sizes = live.every((k) => k.size !== undefined) ? normalize(live.map((k) => k.size!)) : [];
  const shared = {
    axis,
    ...(sizes.length > 0 && !sizes.every((s) => s === sizes[0]) ? { sizes } : {}),
  };
  return newId
    ? { kind: 'split', id: newId(), ...shared, children: live.map((k) => k.node as LayoutNode) }
    : { kind: 'split', ...shared, children: live.map((k) => k.node as SavedNode) };
}

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  return total > 0 ? sizes.map((s) => s / total) : sizes;
}
