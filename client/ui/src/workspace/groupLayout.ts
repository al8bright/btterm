import type { PaneDirection } from '@btterm/core';

/**
 * 탭 그룹 분할(F3.10a, DESIGN §5.4b). 작업 영역은 분할 나무다.
 * 잎 = 칸(탭 그룹, 칸마다 탭바), 묶음 = 방향 + 자식들 + 비율. 어느 칸이든 다시 네 방향으로 나눌 수 있고,
 * 경계를 끌거나 키보드로 비율을 바꾼다(F3.10b).
 * 순수 함수만 두고 상태는 AppStore가 갖는다.
 */

export type SplitAxis = 'row' | 'column';
export type DropSide = 'left' | 'right' | 'top' | 'bottom';
/** 칸 터미널 위에 놓을 곳: 가장자리 = 새 칸, 가운데 = 그 칸으로 옮기기 */
export type DropSpot = DropSide | 'center';

/** 칸(나무의 잎) */
export interface PaneGroup {
  kind: 'group';
  id: string;
  tabs: string[];
  /** 칸에서 보이는 탭 */
  active: string | null;
}

/** 분할 묶음. row = 좌우로 나란히, column = 위아래로 */
export interface SplitNode {
  kind: 'split';
  id: string;
  axis: SplitAxis;
  children: LayoutNode[];
  /** 자식별 비율(합 1, F3.10b). 없으면 균등 */
  sizes?: number[];
}

export type LayoutNode = PaneGroup | SplitNode;

export interface GroupLayout {
  root: LayoutNode;
  /** 활성 칸(키 입력 대상) */
  focused: string;
}

/** 놓기 영역의 화면 위치(getBoundingClientRect) */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 보이는 터미널마다 WebGL을 쓰므로 Chromium 컨텍스트 상한(16) 안에서 정한다(SV10). */
export const MAX_GROUPS = 8;
/** 가장자리로 보는 범위(칸 크기 대비) */
const EDGE = 0.25;
/** 나눈 뒤 새 칸의 최소 크기(px). 이보다 작아지는 방향으로는 나누지 않는다(DESIGN §5.4b). */
export const MIN_PANE = { width: 160, height: 120 };

const ALL_SIDES: DropSide[] = ['left', 'right', 'top', 'bottom'];
/** 경계를 옮겨도 한 칸이 이보다 작아지지 않는다(묶음 크기 대비) */
const MIN_SHARE = 0.15;
/** 키보드로 칸 크기를 바꿀 때 한 번에 옮기는 비율 */
const NUDGE = 0.05;

/** 묶음 자식들의 비율(없으면 균등) */
export function sharesOf(node: SplitNode): number[] {
  const n = node.children.length;
  return node.sizes?.length === n ? node.sizes : node.children.map(() => 1 / n);
}

/** 비율을 합 1로 맞추고, 균등하면 저장하지 않는다 */
function withSizes(node: SplitNode, children: LayoutNode[], shares: number[]): SplitNode {
  const total = shares.reduce((sum, share) => sum + share, 0) || 1;
  const sizes = shares.map((share) => share / total);
  const equal = sizes.every((size) => Math.abs(size - 1 / sizes.length) < 1e-9);
  const { kind, id, axis } = node;
  return equal ? { kind, id, axis, children } : { kind, id, axis, children, sizes };
}

const axisOf = (side: DropSide): SplitAxis =>
  side === 'left' || side === 'right' ? 'row' : 'column';
const isBefore = (side: DropSide): boolean => side === 'left' || side === 'top';

export function initialLayout(id: string): GroupLayout {
  return { root: { kind: 'group', id, tabs: [], active: null }, focused: id };
}

/** 칸 목록(화면 순서: 왼쪽·위부터) */
export function allGroups(layout: GroupLayout): PaneGroup[] {
  const walk = (node: LayoutNode): PaneGroup[] =>
    node.kind === 'group' ? [node] : node.children.flatMap(walk);
  return walk(layout.root);
}

export function groupOf(layout: GroupLayout, sessionId: string): PaneGroup | undefined {
  return allGroups(layout).find((g) => g.tabs.includes(sessionId));
}

export function focusedGroup(layout: GroupLayout): PaneGroup | undefined {
  const groups = allGroups(layout);
  return groups.find((g) => g.id === layout.focused) ?? groups[0];
}

/** 키 입력 대상 세션 = 활성 칸의 선택 탭 */
export function activeSession(layout: GroupLayout): string | null {
  return focusedGroup(layout)?.active ?? null;
}

function mapNode(node: LayoutNode, fn: (node: LayoutNode) => LayoutNode): LayoutNode {
  const next = fn(node);
  if (next !== node || node.kind === 'group') return next;
  return { ...node, children: node.children.map((child) => mapNode(child, fn)) };
}

function replaceGroup(layout: GroupLayout, group: PaneGroup): GroupLayout {
  const root = mapNode(layout.root, (n) => (n.kind === 'group' && n.id === group.id ? group : n));
  return { ...layout, root };
}

/** 하나만 남은 묶음은 풀고, 같은 방향 자식 묶음은 펼친다(비율은 곱해서 유지). 비면 null. */
function normalize(node: SplitNode): LayoutNode | null {
  const shares = sharesOf(node);
  const entries = node.children.flatMap((child, i): Array<[LayoutNode, number]> => {
    const share = shares[i] ?? 0;
    if (child.kind !== 'split' || child.axis !== node.axis) return [[child, share]];
    const inner = sharesOf(child);
    return child.children.map((c, j) => [c, share * (inner[j] ?? 0)]);
  });
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]?.[0] ?? null;
  return withSizes(
    node,
    entries.map(([child]) => child),
    entries.map(([, share]) => share),
  );
}

const firstGroup = (node: LayoutNode): PaneGroup =>
  node.kind === 'group' ? node : firstGroup(node.children[0] ?? node);
const lastGroup = (node: LayoutNode): PaneGroup =>
  node.kind === 'group' ? node : lastGroup(node.children.at(-1) ?? node);

/** 같은 묶음에서 바로 옆 칸(뒤쪽 우선). 칸이 사라질 때 활성을 넘길 곳. */
function siblingOf(node: LayoutNode, groupId: string): PaneGroup | undefined {
  if (node.kind === 'group') return undefined;
  const index = node.children.findIndex((c) => c.kind === 'group' && c.id === groupId);
  if (index >= 0) {
    const next = node.children[index + 1];
    const previous = node.children[index - 1];
    return next ? firstGroup(next) : previous ? lastGroup(previous) : undefined;
  }
  for (const child of node.children) {
    const found = siblingOf(child, groupId);
    if (found) return found;
  }
  return undefined;
}

/** 칸을 나무에서 뺀다. 남은 칸들은 원래 비율대로 자리를 나눠 가진다. */
function prune(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.kind === 'group') return node.id === groupId ? null : node;
  const shares = sharesOf(node);
  const kept = node.children
    .map((child, i): [LayoutNode | null, number] => [prune(child, groupId), shares[i] ?? 0])
    .filter((entry): entry is [LayoutNode, number] => entry[0] !== null);
  return normalize({
    ...node,
    children: kept.map(([child]) => child),
    sizes: kept.map(([, share]) => share),
  });
}

/** target 칸의 side 쪽에 새 칸을 넣는다. 같은 방향 묶음이면 옆에, 아니면 target 자리를 새 묶음으로. */
function insertBeside(
  node: LayoutNode,
  targetId: string,
  side: DropSide,
  group: PaneGroup,
): LayoutNode {
  const axis = axisOf(side);
  const pair = (target: LayoutNode): LayoutNode[] =>
    isBefore(side) ? [group, target] : [target, group];
  if (node.kind === 'group') {
    if (node.id !== targetId) return node;
    return { kind: 'split', id: `${group.id}:split`, axis, children: pair(node) };
  }
  const index = node.children.findIndex((c) => c.kind === 'group' && c.id === targetId);
  const target = node.children[index];
  if (target && node.axis === axis) {
    // 나눈 칸의 자리를 반씩 나눈다
    const children = [...node.children];
    children.splice(index, 1, ...pair(target));
    const shares = [...sharesOf(node)];
    const half = (shares[index] ?? 0) / 2;
    shares.splice(index, 1, half, half);
    return withSizes(node, children, shares);
  }
  return {
    ...node,
    children: node.children.map((child) => insertBeside(child, targetId, side, group)),
  };
}

/** 새 탭은 활성 칸 끝에 붙고 선택된다. */
export function addTab(layout: GroupLayout, sessionId: string): GroupLayout {
  const group = focusedGroup(layout);
  if (!group) return layout;
  return {
    ...replaceGroup(layout, { ...group, tabs: [...group.tabs, sessionId], active: sessionId }),
    focused: group.id,
  };
}

export function activateTab(layout: GroupLayout, sessionId: string): GroupLayout {
  const group = groupOf(layout, sessionId);
  if (!group || (group.active === sessionId && layout.focused === group.id)) return layout;
  return { ...replaceGroup(layout, { ...group, active: sessionId }), focused: group.id };
}

/** 활성 칸 안에서만 돈다. */
export function cycleTab(layout: GroupLayout, step: 1 | -1): GroupLayout {
  const group = focusedGroup(layout);
  if (!group || group.tabs.length === 0) return layout;
  const index = group.active ? group.tabs.indexOf(group.active) : 0;
  const next = group.tabs[(index + step + group.tabs.length) % group.tabs.length];
  return next ? activateTab(layout, next) : layout;
}

/** 탭을 칸에서 뺀다. 빈 칸은 (마지막 칸이 아니면) 없애고 이웃 칸을 활성으로. */
export function removeTab(layout: GroupLayout, sessionId: string): GroupLayout {
  const group = groupOf(layout, sessionId);
  if (!group) return layout;
  const index = group.tabs.indexOf(sessionId);
  const tabs = group.tabs.filter((id) => id !== sessionId);
  const groups = allGroups(layout);
  if (tabs.length === 0 && groups.length > 1) {
    // 칸이 2개 이상이므로 하나를 빼도 나무는 비지 않는다.
    const root = prune(layout.root, group.id) ?? layout.root;
    const focused =
      layout.focused === group.id
        ? (siblingOf(layout.root, group.id)?.id ?? layout.focused)
        : layout.focused;
    return { root, focused };
  }
  const active =
    group.active === sessionId ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : group.active;
  return replaceGroup(layout, { ...group, tabs, active });
}

/**
 * target 칸 위에 sessionId 탭을 놓을 수 있는 곳.
 * 어느 칸이든 네 방향으로 나눌 수 있다. 탭 하나뿐인 자기 칸은 불가, 최대 8칸.
 */
export function allowedSpots(
  layout: GroupLayout,
  targetGroupId: string,
  sessionId: string,
): DropSpot[] {
  const groups = allGroups(layout);
  const source = groupOf(layout, sessionId);
  const target = groups.find((g) => g.id === targetGroupId);
  if (!source || !target) return [];
  const emptiesSource = source.tabs.length === 1;
  const spots: DropSpot[] = source === target ? [] : ['center'];
  if (source === target && emptiesSource) return spots;
  const remaining = groups.length - (emptiesSource ? 1 : 0);
  if (remaining + 1 > MAX_GROUPS) return spots;
  return [...spots, ...ALL_SIDES];
}

/** target 칸의 side 쪽에 sessionId 탭만 든 새 칸을 만든다. 허용되지 않으면 그대로. */
export function splitTab(
  layout: GroupLayout,
  sessionId: string,
  targetGroupId: string,
  side: DropSide,
  newGroupId: string,
): GroupLayout {
  if (!allowedSpots(layout, targetGroupId, sessionId).includes(side)) return layout;
  // 묶음 id는 `${칸 id}:split`이라 칸 id가 겹치면 묶음 id도 겹친다.
  if (allGroups(layout).some((g) => g.id === newGroupId)) return layout;
  const detached = removeTab(layout, sessionId);
  if (!allGroups(detached).some((g) => g.id === targetGroupId)) return layout;
  const group: PaneGroup = { kind: 'group', id: newGroupId, tabs: [sessionId], active: sessionId };
  return { root: insertBeside(detached.root, targetGroupId, side, group), focused: newGroupId };
}

/** sessionId 탭을 target 칸의 index 자리(없으면 끝)로 옮기고 선택한다. */
export function moveTab(
  layout: GroupLayout,
  sessionId: string,
  targetGroupId: string,
  index?: number,
): GroupLayout {
  if (!groupOf(layout, sessionId)) return layout;
  const detached = removeTab(layout, sessionId);
  const target = allGroups(detached).find((g) => g.id === targetGroupId);
  if (!target) return layout;
  const tabs = [...target.tabs];
  tabs.splice(index ?? tabs.length, 0, sessionId);
  return { ...replaceGroup(detached, { ...target, tabs, active: sessionId }), focused: target.id };
}

/** 모든 탭을 활성 칸 하나로 모은다. */
export function mergeAll(layout: GroupLayout): GroupLayout {
  const group = focusedGroup(layout);
  const groups = allGroups(layout);
  if (!group || groups.length < 2) return layout;
  return { root: { ...group, tabs: groups.flatMap((g) => g.tabs) }, focused: group.id };
}

/** 칸 크기가 작아 나누면 MIN_PANE보다 작아지는 방향을 뺀다. */
export function spotsForSize(
  spots: DropSpot[],
  size: { width: number; height: number },
): DropSpot[] {
  const narrow = size.width < MIN_PANE.width * 2;
  const short = size.height < MIN_PANE.height * 2;
  return spots.filter((spot) => {
    if (spot === 'left' || spot === 'right') return !narrow;
    if (spot === 'top' || spot === 'bottom') return !short;
    return true;
  });
}

/** 포인터 위치의 놓을 곳: 가장 가까운 허용된 변이 가장자리 범위 안이면 그 변, 아니면 가운데(허용될 때). */
export function spotAt(rect: Box, x: number, y: number, allowed: DropSpot[]): DropSpot | null {
  const rx = rect.width > 0 ? (x - rect.left) / rect.width : 0.5;
  const ry = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  const distance: Record<DropSide, number> = { left: rx, right: 1 - rx, top: ry, bottom: 1 - ry };
  let side: DropSide | null = null;
  for (const spot of allowed) {
    if (spot !== 'center' && (side === null || distance[spot] < distance[side])) side = spot;
  }
  if (side && distance[side] <= EDGE) return side;
  return allowed.includes('center') ? 'center' : null;
}

/** id로 묶음을 찾는다 */
export function findSplit(node: LayoutNode, splitId: string): SplitNode | undefined {
  if (node.kind === 'group') return undefined;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const found = findSplit(child, splitId);
    if (found) return found;
  }
  return undefined;
}

/** 묶음 splitId의 border번째 경계(자식 border와 border+1 사이)를 delta만큼 옮긴다(F3.10b). */
export function resizeSplit(
  layout: GroupLayout,
  splitId: string,
  border: number,
  delta: number,
): GroupLayout {
  let changed = false;
  const root = mapNode(layout.root, (node) => {
    if (node.kind !== 'split' || node.id !== splitId) return node;
    const shares = [...sharesOf(node)];
    const a = shares[border];
    const b = shares[border + 1];
    if (a === undefined || b === undefined) return node;
    // 여러 번 나눠 이미 최소보다 작은 칸도 움직일 수 있게 최소를 두 칸 합의 1/3까지 낮추고,
    // 이미 그보다 작은 칸은 지금 크기를 바닥으로 삼아 줄이는 쪽으로 끌 때 거꾸로 커지지 않게 한다(리뷰 4).
    const floor = Math.min(MIN_SHARE, (a + b) / 3);
    const lower = Math.min(floor, a);
    const upper = a + b - Math.min(floor, b);
    const nextA = Math.min(Math.max(a + delta, lower), upper);
    if (nextA === a) return node;
    shares[border] = nextA;
    shares[border + 1] = a + b - nextA;
    changed = true;
    return withSizes(node, node.children, shares);
  });
  return changed ? { ...layout, root } : layout;
}

/** 뿌리에서 칸까지 거치는 묶음과 그 안의 자식 순번 */
function pathTo(
  node: LayoutNode,
  groupId: string,
): Array<{ node: SplitNode; index: number }> | null {
  if (node.kind === 'group') return node.id === groupId ? [] : null;
  for (const [index, child] of node.children.entries()) {
    const rest = pathTo(child, groupId);
    if (rest) return [{ node, index }, ...rest];
  }
  return null;
}

/** 활성 칸에 붙은 경계를 direction 쪽으로 옮긴다(Ctrl+Alt+Shift+방향키). 그 방향 묶음이 없으면 그대로. */
export function nudgeFocused(layout: GroupLayout, direction: PaneDirection): GroupLayout {
  const axis: SplitAxis = direction === 'Left' || direction === 'Right' ? 'row' : 'column';
  const sign = direction === 'Right' || direction === 'Down' ? 1 : -1;
  const path = pathTo(layout.root, layout.focused) ?? [];
  const step = [...path].reverse().find(({ node }) => node.axis === axis);
  if (!step) return layout;
  const border = step.index < step.node.children.length - 1 ? step.index : step.index - 1;
  return resizeSplit(layout, step.node.id, border, sign * NUDGE);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 칸마다 작업 영역 안 위치(0~1) */
function rects(node: LayoutNode, area: Rect, out: Map<string, Rect>): Map<string, Rect> {
  if (node.kind === 'group') return out.set(node.id, area);
  let offset = 0;
  sharesOf(node).forEach((share, i) => {
    const child = node.children[i];
    if (!child) return;
    const part =
      node.axis === 'row'
        ? { ...area, x: area.x + area.w * offset, w: area.w * share }
        : { ...area, y: area.y + area.h * offset, h: area.h * share };
    rects(child, part, out);
    offset += share;
  });
  return out;
}

/** direction 쪽에서 가장 가까운 칸으로 포커스를 옮긴다(Ctrl+Alt+방향키). 없으면 그대로. */
export function focusNeighbor(layout: GroupLayout, direction: PaneDirection): GroupLayout {
  const boxes = rects(layout.root, { x: 0, y: 0, w: 1, h: 1 }, new Map());
  const from = boxes.get(layout.focused);
  if (!from) return layout;
  const horizontal = direction === 'Left' || direction === 'Right';
  const eps = 1e-6;
  let best: { id: string; gap: number; off: number } | null = null;
  for (const [id, box] of boxes) {
    if (id === layout.focused) continue;
    const gap =
      direction === 'Right'
        ? box.x - (from.x + from.w)
        : direction === 'Left'
          ? from.x - (box.x + box.w)
          : direction === 'Down'
            ? box.y - (from.y + from.h)
            : from.y - (box.y + box.h);
    const overlaps = horizontal
      ? box.y < from.y + from.h - eps && box.y + box.h > from.y + eps
      : box.x < from.x + from.w - eps && box.x + box.w > from.x + eps;
    if (gap < -eps || !overlaps) continue;
    const off = horizontal
      ? Math.abs(box.y + box.h / 2 - (from.y + from.h / 2))
      : Math.abs(box.x + box.w / 2 - (from.x + from.w / 2));
    if (
      !best ||
      gap < best.gap - eps ||
      (Math.abs(gap - best.gap) <= eps && off < best.off - eps)
    ) {
      best = { id, gap, off };
    }
  }
  return best ? { ...layout, focused: best.id } : layout;
}

/** 활성 칸의 n번째 탭(9 = 마지막, Ctrl+Shift+1~9). 없으면 그대로. */
export function goToTab(layout: GroupLayout, n: number): GroupLayout {
  const group = focusedGroup(layout);
  const id = n === 9 ? group?.tabs.at(-1) : group?.tabs[n - 1];
  return id ? activateTab(layout, id) : layout;
}
