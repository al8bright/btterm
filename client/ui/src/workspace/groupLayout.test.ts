import { describe, expect, it } from 'vitest';
import {
  activateTab,
  activeSession,
  addTab,
  allGroups,
  allowedSpots,
  cycleTab,
  focusNeighbor,
  goToTab,
  initialLayout,
  mergeAll,
  moveTab,
  nudgeFocused,
  removeTab,
  resizeSplit,
  spotAt,
  spotsForSize,
  splitTab,
  type GroupLayout,
  type LayoutNode,
  type PaneGroup,
  type SplitAxis,
} from './groupLayout';

// 배치 만들기: 칸 g('g1', 'a', 'b')의 선택 탭은 마지막. 묶음 row(...)/column(...).
const g = (id: string, ...tabs: string[]): PaneGroup => ({
  kind: 'group',
  id,
  tabs,
  active: tabs.at(-1) ?? null,
});
let splitIds = 0;
const split =
  (axis: SplitAxis) =>
  (...children: LayoutNode[]): LayoutNode => ({
    kind: 'split',
    id: `s${++splitIds}`,
    axis,
    children,
  });
const row = split('row');
const column = split('column');
const L = (root: LayoutNode, focused = 'g1'): GroupLayout => ({ root, focused });

/** 배치 모양: 칸 = 탭 목록, 묶음 = row[ … | … ] */
function shape(node: LayoutNode | GroupLayout): string {
  if ('root' in node) return shape(node.root);
  if (node.kind === 'group') return node.tabs.join(',');
  return `${node.axis}[${node.children.map(shape).join(' | ')}]`;
}

describe('groupLayout (F3.10a)', () => {
  it('새 탭은 활성 칸 끝에 붙고 선택된다', () => {
    let l = initialLayout('g1');
    l = addTab(addTab(l, 'a'), 'b');
    expect(shape(l)).toBe('a,b');
    expect(activeSession(l)).toBe('b');
    l = addTab(L(row(g('g1', 'a'), g('g2', 'b')), 'g2'), 'c');
    expect(shape(l)).toBe('row[a | b,c]');
  });

  it('탭을 고르면 그 칸이 활성이 되고, 이미 그렇다면 배치가 그대로다', () => {
    const l = activateTab(L(row(g('g1', 'a', 'b'), g('g2', 'c'))), 'a');
    expect(l.focused).toBe('g1');
    expect(allGroups(l)[0]?.active).toBe('a');
    expect(activeSession(activateTab(l, 'c'))).toBe('c');
    expect(activateTab(l, 'a')).toBe(l);
  });

  it('cycleTab은 활성 칸 안에서만 돈다', () => {
    const l = activateTab(L(row(g('g1', 'a', 'b', 'c'), g('g2', 'd'))), 'c');
    expect(activeSession(cycleTab(l, 1))).toBe('a');
    expect(activeSession(cycleTab(l, -1))).toBe('b');
  });

  it('탭을 닫으면 같은 칸 이웃이 선택되고, 빈 칸은 사라지며 이웃 칸이 활성', () => {
    const closeB = removeTab(activateTab(L(g('g1', 'a', 'b', 'c')), 'b'), 'b');
    expect(activeSession(closeB)).toBe('c');
    const l = removeTab(L(row(g('g1', 'a'), g('g2', 'b')), 'g2'), 'b');
    expect(shape(l)).toBe('a');
    expect(activeSession(l)).toBe('a');
    // 칸이 하나뿐이면 비어도 남긴다
    expect(removeTab(L(g('g1', 'a')), 'a').root).toMatchObject({ tabs: [], active: null });
  });

  it('AC33 가장자리에 놓으면 그 쪽에 새 칸을 만들고 그 칸이 활성', () => {
    const l = splitTab(L(g('g1', 'a', 'b')), 'a', 'g1', 'right', 'n');
    expect(shape(l)).toBe('row[b | a]');
    expect(l.focused).toBe('n');
    expect(activeSession(l)).toBe('a');
    expect(shape(splitTab(L(g('g1', 'a', 'b')), 'b', 'g1', 'top', 'n'))).toBe('column[b | a]');
  });

  it('AC33 좌우로 나뉜 칸을 다시 위아래로 나눌 수 있다(중첩 분할)', () => {
    let l = splitTab(L(g('g1', 'a', 'b', 'c')), 'c', 'g1', 'right', 'n1');
    expect(shape(l)).toBe('row[a,b | c]');
    l = splitTab(l, 'b', 'n1', 'bottom', 'n2');
    expect(shape(l)).toBe('row[a | column[c | b]]');
    // 아래 칸을 다시 좌우로
    l = moveTab(l, 'a', 'n2');
    l = splitTab(l, 'a', 'n2', 'left', 'n3');
    expect(shape(l)).toBe('column[c | row[a | b]]');
    // 같은 방향 묶음 안에서는 옆에 끼운다
    l = addTab(l, 'd');
    l = splitTab(l, 'd', 'n2', 'right', 'n4');
    expect(shape(l)).toBe('column[c | row[a | b | d]]');
    expect(allGroups(l)).toHaveLength(4);
  });

  it('칸이 빠져 묶음에 하나만 남으면 묶음을 풀고, 부모와 방향이 같으면 합친다', () => {
    const l = L(row(g('g1', 'a'), column(g('g2', 'b'), row(g('g3', 'c'), g('g4', 'd')))));
    expect(shape(removeTab(l, 'b'))).toBe('row[a | c | d]');
    expect(shape(removeTab(L(column(g('g1', 'a'), row(g('g2', 'b'), g('g3', 'c')))), 'a'))).toBe(
      'row[b | c]',
    );
  });

  it('칸이 사라지면 같은 묶음의 이웃 칸이 활성이 된다', () => {
    const l = L(row(column(g('g1', 'a'), g('g2', 'b')), g('g3', 'c')), 'g2');
    const next = removeTab(l, 'b');
    expect(shape(next)).toBe('row[a | c]');
    expect(next.focused).toBe('g1');
  });

  it('이미 있는 칸 id로는 나누지 않는다', () => {
    const l = L(row(g('g1', 'a', 'b'), g('g2', 'c')));
    expect(splitTab(l, 'b', 'g1', 'right', 'g2')).toBe(l);
  });

  it('다른 칸 가장자리에 놓으면 원래 칸이 비면 없앤다', () => {
    expect(shape(splitTab(L(row(g('g1', 'a'), g('g2', 'b', 'c'))), 'c', 'g1', 'left', 'n'))).toBe(
      'row[c | a | b]',
    );
    expect(shape(splitTab(L(row(g('g1', 'a'), g('g2', 'b'))), 'b', 'g1', 'bottom', 'n'))).toBe(
      'column[a | b]',
    );
  });

  it('allowedSpots: 어느 칸이든 네 방향, 탭 하나뿐인 자기 칸은 불가, 최대 8칸', () => {
    const all = ['left', 'right', 'top', 'bottom'];
    expect(allowedSpots(L(g('g1', 'a', 'b')), 'g1', 'a')).toEqual(all);
    expect(allowedSpots(L(g('g1', 'a')), 'g1', 'a')).toEqual([]);
    expect(allowedSpots(L(row(g('g1', 'a'), g('g2', 'b', 'c'))), 'g1', 'c')).toEqual([
      'center',
      ...all,
    ]);
    const eight = L(row(...Array.from({ length: 8 }, (_, i) => g(`g${i + 1}`, `t${i}`))));
    expect(allowedSpots(eight, 'g1', 't7')).toEqual(['center', ...all]);
    const full = L(
      row(...Array.from({ length: 7 }, (_, i) => g(`g${i + 1}`, `t${i}`)), g('g8', 'x', 'y')),
    );
    expect(allowedSpots(full, 'g1', 'y')).toEqual(['center']);
  });

  it('허용되지 않은 분할은 배치를 바꾸지 않는다', () => {
    const l = L(g('g1', 'a'));
    expect(splitTab(l, 'a', 'g1', 'right', 'n')).toBe(l);
  });

  it('moveTab: 다른 칸으로 옮기면 그 칸에서 선택되고, 같은 칸에서는 순서만 바뀐다', () => {
    const moved = moveTab(L(row(g('g1', 'a', 'b'), g('g2', 'c'))), 'a', 'g2', 0);
    expect(shape(moved)).toBe('row[b | a,c]');
    expect(activeSession(moved)).toBe('a');
    const emptied = moveTab(L(row(g('g1', 'a'), g('g2', 'b'))), 'a', 'g2');
    expect(shape(emptied)).toBe('b,a');
    expect(emptied.focused).toBe('g2');
    expect(shape(moveTab(L(g('g1', 'a', 'b', 'c')), 'c', 'g1', 0))).toBe('c,a,b');
    expect(shape(moveTab(L(g('g1', 'a', 'b', 'c')), 'a', 'g1', 2))).toBe('b,c,a');
  });

  it('mergeAll: 모든 탭을 활성 칸 하나로 모은다', () => {
    const l = mergeAll(
      activateTab(L(column(g('g1', 'a'), row(g('g2', 'b', 'c'), g('g3', 'd')))), 'b'),
    );
    expect(shape(l)).toBe('a,b,c,d');
    expect(activeSession(l)).toBe('b');
  });

  it('spotsForSize: 나누면 너무 작아지는 방향은 뺀다', () => {
    const all = ['center', 'left', 'right', 'top', 'bottom'] as const;
    expect(spotsForSize([...all], { width: 800, height: 600 })).toEqual([...all]);
    expect(spotsForSize([...all], { width: 300, height: 600 })).toEqual([
      'center',
      'top',
      'bottom',
    ]);
    expect(spotsForSize([...all], { width: 800, height: 200 })).toEqual([
      'center',
      'left',
      'right',
    ]);
  });

  it('spotAt: 가장자리 25% 안은 그 변, 그 밖은 가운데(허용될 때)', () => {
    const rect = { left: 0, top: 0, width: 200, height: 100 };
    const all = ['center', 'left', 'right', 'top', 'bottom'] as const;
    expect(spotAt(rect, 190, 50, [...all])).toBe('right');
    expect(spotAt(rect, 100, 10, [...all])).toBe('top');
    expect(spotAt(rect, 100, 50, [...all])).toBe('center');
    // 자기 칸(가운데 불가): 가장자리 밖에 놓으면 아무 일도 없다
    expect(spotAt(rect, 100, 50, ['left', 'right'])).toBeNull();
    expect(spotAt(rect, 30, 50, ['left', 'right'])).toBe('left');
    expect(spotAt(rect, 10, 10, [])).toBeNull();
  });
});

describe('칸 조작 (F3.10b, UX 검토 U4)', () => {
  const sizesOf = (l: GroupLayout) => (l.root.kind === 'split' ? l.root.sizes : undefined);
  const near = (values: number[] | undefined) => values?.map((v) => Math.round(v * 100) / 100);

  it('경계를 옮기면 두 칸 비율이 바뀌고, 한 칸이 15%보다 작아지지 않는다', () => {
    const base = L({ kind: 'split', id: 'r', axis: 'row', children: [g('g1', 'a'), g('g2', 'b')] });
    expect(near(sizesOf(resizeSplit(base, 'r', 0, 0.2)))).toEqual([0.7, 0.3]);
    expect(near(sizesOf(resizeSplit(base, 'r', 0, 0.9)))).toEqual([0.85, 0.15]);
    expect(resizeSplit(base, 'nope', 0, 0.2)).toBe(base);
  });

  it('여러 번 나눠 작아진 칸도 경계를 옮길 수 있고, 줄이는 쪽으로 끌 때 거꾸로 커지지 않는다(리뷰 4)', () => {
    const small = L({
      kind: 'split',
      id: 'r',
      axis: 'row',
      sizes: [0.125, 0.125, 0.75],
      children: [g('g1', 'a'), g('g2', 'b'), g('g3', 'c')],
    });
    const grown = sizesOf(resizeSplit(small, 'r', 0, 0.02))!;
    expect(grown[0]).toBeCloseTo(0.145);
    expect(grown[1]).toBeCloseTo(0.105);
    const shrink = resizeSplit(small, 'r', 1, -0.5);
    expect(sizesOf(shrink)?.[1]).toBeLessThanOrEqual(0.125 + 1e-9);
    expect(sizesOf(resizeSplit(small, 'r', 0, -0.01))?.[0]).toBeLessThanOrEqual(0.125 + 1e-9);
  });

  it('칸을 닫아도 남은 칸들의 비율을 지키고, 옆에 나누면 그 칸을 반으로 나눈다', () => {
    const base = L({
      kind: 'split',
      id: 'r',
      axis: 'row',
      sizes: [0.5, 0.25, 0.25],
      children: [g('g1', 'a'), g('g2', 'b'), g('g3', 'c')],
    });
    expect(near(sizesOf(removeTab(base, 'b')))).toEqual([0.67, 0.33]);
    const split3 = splitTab(base, 'a', 'g3', 'right', 'g4');
    expect(shape(split3)).toBe('row[b | c | a]');
  });

  it('Ctrl+Alt+방향키: 그 방향의 가장 가까운 칸으로 포커스를 옮긴다', () => {
    // A | (B 위 / C 아래)
    const base = L(row(g('A', 'a'), column(g('B', 'b'), g('C', 'c'))), 'A');
    expect(focusNeighbor(base, 'Right').focused).toBe('B');
    expect(focusNeighbor(base, 'Left')).toBe(base);
    const atC = { ...base, focused: 'C' };
    expect(focusNeighbor(atC, 'Up').focused).toBe('B');
    expect(focusNeighbor(atC, 'Left').focused).toBe('A');
  });

  it('Ctrl+Alt+Shift+방향키: 활성 칸에 붙은 경계를 그 방향으로 5% 옮긴다', () => {
    const base = L({ kind: 'split', id: 'r', axis: 'row', children: [g('g1', 'a'), g('g2', 'b')] });
    expect(near(sizesOf(nudgeFocused(base, 'Right')))).toEqual([0.55, 0.45]);
    expect(near(sizesOf(nudgeFocused({ ...base, focused: 'g2' }, 'Left')))).toEqual([0.45, 0.55]);
    // 위아래로 나뉜 묶음이 없으면 그대로
    expect(nudgeFocused(base, 'Up')).toBe(base);
  });

  it('Ctrl+Shift+N: 활성 칸의 N번째 탭, 9는 마지막 탭', () => {
    const base = L(g('g1', 'a', 'b', 'c'));
    expect(activeSession(goToTab(base, 2))).toBe('b');
    expect(activeSession(goToTab({ ...base, root: g('g1', 'a', 'b', 'c') }, 9))).toBe('c');
    expect(goToTab(base, 5)).toBe(base);
  });
});
