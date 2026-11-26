import { describe, expect, it } from 'vitest';
import { emptyProfileStore, type Group, type Profile, type ProfileStore } from './model';
import { moveTreeItem, treeChildren } from './treeOrder';

const group = (id: string, parentId: string | null, order: number): Group => ({
  id,
  parentId,
  name: id,
  order,
  defaults: {},
});

const profile = (id: string, groupId: string | null, extra: Partial<Profile> = {}): Profile => ({
  id,
  groupId,
  name: id,
  host: `${id}.local`,
  overrides: {},
  tags: [],
  updatedAt: 0,
  ...extra,
});

// Test(그룹) 아래 Test01·Test02, 최상위에 Prod 그룹과 laptop 서버
const store: ProfileStore = {
  ...emptyProfileStore(),
  groups: [group('test', null, 1), group('prod', null, 0)],
  profiles: [profile('Test02', 'test'), profile('Test01', 'test'), profile('laptop', null)],
};

const ids = (s: Pick<ProfileStore, 'groups' | 'profiles'>, parentId: string | null) =>
  treeChildren(s, parentId).map((c) => `${c.kind}:${c.id}`);

describe('treeOrder (F1.2a)', () => {
  it('순서가 없으면 그룹 먼저(order 순), 그다음 서버 이름순', () => {
    expect(ids(store, null)).toEqual(['group:prod', 'group:test', 'profile:laptop']);
    expect(ids(store, 'test')).toEqual(['profile:Test01', 'profile:Test02']);
  });

  it('AC35 서버를 그룹 안으로 옮기면 그 그룹의 마지막 자식이 된다', () => {
    const next = moveTreeItem(store, { kind: 'profile', id: 'laptop' }, 'test', 2);
    expect(next.profiles.find((p) => p.id === 'laptop')?.groupId).toBe('test');
    expect(ids(next, 'test')).toEqual(['profile:Test01', 'profile:Test02', 'profile:laptop']);
    expect(ids(next, null)).toEqual(['group:prod', 'group:test']);
  });

  it('AC35 그룹 안 서버를 최상위로 빼며 원하는 자리에 놓는다', () => {
    const next = moveTreeItem(store, { kind: 'profile', id: 'Test02' }, null, 0);
    expect(next.profiles.find((p) => p.id === 'Test02')?.groupId).toBeNull();
    expect(ids(next, null)).toEqual([
      'profile:Test02',
      'group:prod',
      'group:test',
      'profile:laptop',
    ]);
    expect(ids(next, 'test')).toEqual(['profile:Test01']);
  });

  it('AC35 같은 단계에서 서버와 그룹의 순서를 자유롭게 바꾼다', () => {
    let next = moveTreeItem(store, { kind: 'profile', id: 'Test02' }, 'test', 0);
    expect(ids(next, 'test')).toEqual(['profile:Test02', 'profile:Test01']);
    next = moveTreeItem(next, { kind: 'group', id: 'prod' }, null, 2);
    expect(ids(next, null)).toEqual(['group:test', 'profile:laptop', 'group:prod']);
  });

  it('AC35 그룹을 다른 그룹 안으로 옮기면 하위째 따라간다', () => {
    const next = moveTreeItem(store, { kind: 'group', id: 'test' }, 'prod', 0);
    expect(next.groups.find((g) => g.id === 'test')?.parentId).toBe('prod');
    expect(ids(next, 'prod')).toEqual(['group:test']);
    expect(ids(next, 'test')).toEqual(['profile:Test01', 'profile:Test02']);
  });

  it('그룹을 자기 자신이나 하위로 옮기려 하면 바꾸지 않는다', () => {
    const nested = moveTreeItem(store, { kind: 'group', id: 'test' }, 'prod', 0);
    expect(moveTreeItem(nested, { kind: 'group', id: 'prod' }, 'test', 0)).toBe(nested);
    expect(moveTreeItem(nested, { kind: 'group', id: 'prod' }, 'prod', 0)).toBe(nested);
  });

  it('없는 대상이나 없는 부모는 바꾸지 않는다', () => {
    expect(moveTreeItem(store, { kind: 'profile', id: 'none' }, null, 0)).toBe(store);
    expect(moveTreeItem(store, { kind: 'profile', id: 'laptop' }, 'none', 0)).toBe(store);
  });

  it('위치가 범위를 벗어나면 끝(또는 처음)으로 맞춘다', () => {
    const next = moveTreeItem(store, { kind: 'profile', id: 'Test01' }, 'test', 99);
    expect(ids(next, 'test')).toEqual(['profile:Test02', 'profile:Test01']);
    const first = moveTreeItem(store, { kind: 'profile', id: 'laptop' }, null, -5);
    expect(ids(first, null)[0]).toBe('profile:laptop');
  });
});
