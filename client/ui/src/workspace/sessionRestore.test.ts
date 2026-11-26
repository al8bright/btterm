import { describe, expect, it } from 'vitest';
import type { SavedNode } from '@btterm/core';
import type { GroupLayout } from './groupLayout';
import { allGroups } from './groupLayout';
import { rebuildLayout, savedTabsInOrder, snapshotSession } from './sessionRestore';

const layout: GroupLayout = {
  focused: 'g2',
  root: {
    kind: 'split',
    id: 'sp',
    axis: 'row',
    sizes: [0.6, 0.4],
    children: [
      { kind: 'group', id: 'g1', tabs: ['s1', 's2'], active: 's2' },
      { kind: 'group', id: 'g2', tabs: ['s3'], active: 's3' },
    ],
  },
};
const tabs = [
  { sessionId: 's1', profileId: 'p1' },
  { sessionId: 's2', quick: { host: 'h', port: 22, username: 'a' } },
  { sessionId: 's3', profileId: 'p2' },
];
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

describe('재시작 시 탭 복원 (F6.9, DF8)', () => {
  it('칸 배치와 탭을 저장 형식으로 바꾼다. 탭이 없으면 null', () => {
    expect(snapshotSession(layout, tabs)).toEqual(saved);
    expect(
      snapshotSession(
        { focused: 'g', root: { kind: 'group', id: 'g', tabs: [], active: null } },
        [],
      ),
    ).toBeNull();
  });

  it('탭을 여는 순서는 칸 순서(왼쪽·위부터)', () => {
    expect(savedTabsInOrder(saved)).toEqual([
      { profileId: 'p1' },
      { quick: { host: 'h', port: 22, username: 'a' } },
      { profileId: 'p2' },
    ]);
  });

  it('연 세션 id로 배치를 되살리고, 열지 못한 탭이 모두 빠진 칸은 없앤다', () => {
    let n = 0;
    const id = () => `n${++n}`;
    const full = rebuildLayout(saved, ['a', 'b', 'c'], id)!;
    expect(allGroups(full).map((g) => g.tabs)).toEqual([['a', 'b'], ['c']]);
    expect(full.root).toMatchObject({ kind: 'split', axis: 'row', sizes: [0.6, 0.4] });

    const partial = rebuildLayout(saved, ['a', null, null], id)!;
    expect(partial.root).toMatchObject({ kind: 'group', tabs: ['a'], active: 'a' });
    expect(rebuildLayout(saved, [null, null, null], id)).toBeNull();
  });
});
