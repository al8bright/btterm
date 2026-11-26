import { describe, expect, it } from 'vitest';
import { emptyProfileStore, toProfilesView, type Profile } from '@btterm/core';
import { buildServerTree } from './serverTree';

const profile = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  groupId: null,
  name,
  host: `${name}.example`,
  overrides: {},
  tags: [],
  updatedAt: 0,
  ...extra,
});

const view = toProfilesView({
  ...emptyProfileStore(),
  groups: [
    {
      id: 'prod',
      parentId: null,
      name: 'Prod',
      order: 0,
      defaults: { icon: { kind: 'builtin', name: 'database' } },
    },
    { id: 'prod-web', parentId: 'prod', name: 'Web', order: 0, defaults: {} },
    { id: 'stg', parentId: null, name: 'Staging', order: 1, defaults: {} },
  ],
  profiles: [
    profile('p1', 'db-01', { groupId: 'prod', lastConnectedAt: 30 }),
    profile('p2', 'web-01', {
      groupId: 'prod-web',
      overrides: { icon: { kind: 'builtin', name: 'web' } },
      pinned: true,
      tags: ['nginx'],
    }),
    profile('p3', 'stg-01', { groupId: 'stg', lastConnectedAt: 50 }),
    profile('p4', 'laptop', { groupId: null }),
  ],
});

const names = (rows: ReturnType<typeof buildServerTree>) =>
  rows.map((r) => `${'  '.repeat(r.level - 1)}${r.kind}:${r.label}`);

describe('buildServerTree (F1.2)', () => {
  it('고정 구역 다음에 그룹 트리, 그룹 없는 서버는 끝에. 최근 접속 구역은 없다', () => {
    expect(names(buildServerTree(view, { query: '', collapsed: new Set() }))).toEqual([
      'section:pinned',
      'profile:web-01',
      'section:all',
      'group:Prod',
      '  group:Web',
      '    profile:web-01',
      '  profile:db-01',
      'group:Staging',
      '  profile:stg-01',
      'profile:laptop',
    ]);
  });

  it('AC35 저장된 순서(order)대로 그룹과 서버를 섞어 보여주고 행에 부모·위치를 단다', () => {
    const ordered = toProfilesView({
      ...emptyProfileStore(),
      groups: [{ id: 'g', parentId: null, name: 'G', order: 1, defaults: {} }],
      profiles: [profile('a', 'a-srv', { order: 2 }), profile('b', 'b-srv', { order: 0 })],
    });
    const rows = buildServerTree(ordered, { query: '', collapsed: new Set() });
    expect(names(rows)).toEqual(['profile:b-srv', 'group:G', 'profile:a-srv']);
    expect(rows.map((r) => (r.kind === 'section' ? null : [r.parentId, r.index]))).toEqual([
      [null, 0],
      [null, 1],
      [null, 2],
    ]);
  });

  it('접힌 그룹의 하위는 숨긴다', () => {
    const rows = buildServerTree(view, { query: '', collapsed: new Set(['prod']) });
    expect(rows.find((r) => r.kind === 'group' && r.id === 'prod')).toMatchObject({
      expanded: false,
    });
    expect(rows.some((r) => r.kind === 'group' && r.id === 'prod-web')).toBe(false);
    expect(rows.some((r) => r.kind === 'profile' && r.id === 'p1')).toBe(false);
  });

  it('검색하면 이름·주소·태그로 퍼지 일치한 서버만 평평하게 보여준다(F5.1)', () => {
    expect(names(buildServerTree(view, { query: 'nginx', collapsed: new Set() }))).toEqual([
      'profile:web-01',
    ]);
    expect(names(buildServerTree(view, { query: 'w1', collapsed: new Set() }))).toEqual([
      'profile:web-01',
    ]);
    expect(names(buildServerTree(view, { query: '01', collapsed: new Set() }))).toEqual([
      'profile:db-01',
      'profile:stg-01',
      'profile:web-01',
    ]);
  });

  it('AC29 그룹 아이콘을 물려받고, 재정의한 서버만 자기 아이콘', () => {
    const rows = buildServerTree(view, { query: '', collapsed: new Set() });
    const icon = (id: string) => {
      const row = rows.find((r) => r.kind === 'profile' && r.id === id);
      return row?.kind === 'profile' ? row.icon : undefined;
    };
    expect(icon('p1')).toEqual({ kind: 'builtin', name: 'database' });
    expect(icon('p2')).toEqual({ kind: 'builtin', name: 'web' });
    expect(icon('p3')).toBeUndefined();
  });

  it('그룹 행에는 자기(또는 상위) 그룹이 정한 아이콘 색을 단다', () => {
    const colored = toProfilesView({
      ...emptyProfileStore(),
      groups: [
        {
          id: 'g',
          parentId: null,
          name: 'G',
          order: 0,
          defaults: { icon: { kind: 'builtin', name: 'cloud', color: 'teal' } },
        },
        { id: 'h', parentId: 'g', name: 'H', order: 0, defaults: {} },
      ],
      profiles: [],
    });
    const rows = buildServerTree(colored, { query: '', collapsed: new Set() });
    expect(rows.map((r) => (r.kind === 'group' ? r.color : null))).toEqual(['teal', 'teal']);
  });
});
