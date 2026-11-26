import { describe, expect, it } from 'vitest';
import { emptyProfileStore, toProfilesView } from '@btterm/core';
import { moveChangesInheritance } from './treeDrop';

const view = toProfilesView({
  ...emptyProfileStore(),
  groups: [
    { id: 'prod', parentId: null, name: 'Prod', order: 0, defaults: { startupCommand: 'sudo -i' } },
    { id: 'dev', parentId: null, name: 'Dev', order: 1, defaults: { port: 2222 } },
    { id: 'web', parentId: 'dev', name: 'Web', order: 0, defaults: {} },
  ],
  profiles: [
    {
      id: 'p1',
      groupId: 'web',
      name: 'web-01',
      host: '10.0.0.5',
      overrides: {},
      tags: [],
      updatedAt: 0,
    },
  ],
});

describe('moveChangesInheritance (보안 리뷰 L1·L3)', () => {
  it('F6.11 그룹을 옮겨 하위 서버의 연결 직후 명령 상속이 바뀌면 확인한다', () => {
    expect(moveChangesInheritance(view, { kind: 'group', id: 'web' }, 'prod', 0)).toBe(true);
  });

  it('포트처럼 위험하지 않은 값만 바뀌면 묻지 않는다', () => {
    expect(moveChangesInheritance(view, { kind: 'profile', id: 'p1' }, 'dev', 0)).toBe(false);
  });
});
