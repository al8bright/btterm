import { describe, expect, it } from 'vitest';
import {
  importSshConfigHosts,
  removeGroup,
  removeProfile,
  upsertGroup,
  upsertIdentity,
  upsertProfile,
  touchRecent,
} from './storeOps';
import { emptyProfileStore, type Group, type Profile } from './model';
import { SequentialIdGenerator } from '../id/SequentialIdGenerator';
import type { SshConfigHost } from '../import/sshConfig';

const group = (id: string, parentId: string | null = null): Group => ({
  id,
  parentId,
  name: id,
  order: 0,
  defaults: {},
});

const profile = (id: string, groupId: string | null = null): Profile => ({
  id,
  groupId,
  name: id,
  host: `${id}.local`,
  overrides: {},
  tags: [],
  updatedAt: 0,
});

describe('storeOps', () => {
  it('upsertProfile는 새 프로필을 추가하고 같은 ID면 교체한다', () => {
    let store = upsertProfile(emptyProfileStore(), profile('p1'));
    store = upsertProfile(store, { ...profile('p1'), name: '변경' });
    expect(store.profiles.map((p) => p.name)).toEqual(['변경']);
  });

  it('upsertProfile는 없는 그룹을 가리키면 거부한다', () => {
    expect(() => upsertProfile(emptyProfileStore(), profile('p1', 'nope'))).toThrow(/그룹/);
  });

  it('removeProfile는 원본을 바꾸지 않는다', () => {
    const before = upsertProfile(emptyProfileStore(), profile('p1'));
    const after = removeProfile(before, 'p1');
    expect([before.profiles.length, after.profiles.length]).toEqual([1, 0]);
  });

  it('upsertGroup는 자기 자신이나 자손을 부모로 삼는 순환을 거부한다', () => {
    let store = upsertGroup(emptyProfileStore(), group('a'));
    store = upsertGroup(store, group('b', 'a'));
    expect(() => upsertGroup(store, group('a', 'b'))).toThrow(/순환/);
  });

  it('removeGroup는 하위 그룹과 프로필을 부모 그룹으로 올린다', () => {
    let store = upsertGroup(emptyProfileStore(), group('root'));
    store = upsertGroup(store, group('mid', 'root'));
    store = upsertGroup(store, group('leaf', 'mid'));
    store = upsertProfile(store, profile('p1', 'mid'));
    store = removeGroup(store, 'mid');
    expect(store.groups.find((g) => g.id === 'leaf')?.parentId).toBe('root');
    expect(store.profiles[0]?.groupId).toBe('root');
  });

  it('upsertIdentity는 없는 자격증명을 가리키면 거부한다', () => {
    expect(() =>
      upsertIdentity(emptyProfileStore(), {
        id: 'i1',
        label: 'x',
        username: 'u',
        credentialId: 'nope',
      }),
    ).toThrow(/자격증명/);
  });

  it('touchRecent는 최근 접속 시각을 갱신한다', () => {
    const store = touchRecent(upsertProfile(emptyProfileStore(), profile('p1')), 'p1', 1234);
    expect(store.profiles[0]?.lastConnectedAt).toBe(1234);
  });
});

describe('importSshConfigHosts', () => {
  const host = (over: Partial<SshConfigHost>): SshConfigHost => ({
    alias: 'web-01',
    hostName: '10.0.0.5',
    port: null,
    user: null,
    identityFiles: [],
    keepaliveSec: null,
    proxyJump: null,
    unsupported: {},
    needsApproval: [],
    ...over,
  });

  it('F1.4 alias를 이름으로, HostName·Port·User·keepalive를 프로필 값으로 옮긴다', () => {
    const { store, created } = importSshConfigHosts(
      emptyProfileStore(),
      [host({ port: 2222, user: 'ubuntu', keepaliveSec: 15 })],
      { ids: new SequentialIdGenerator('x'), now: 10, groupId: null },
    );
    expect(created).toBe(1);
    expect(store.profiles[0]).toMatchObject({
      name: 'web-01',
      host: '10.0.0.5',
      overrides: { port: 2222, username: 'ubuntu', keepaliveSec: 15 },
      updatedAt: 10,
    });
  });

  it('F1.4 IdentityFile은 경로 참조 키 + Identity로 만든다(키 내용은 읽지 않음)', () => {
    const { store } = importSshConfigHosts(
      emptyProfileStore(),
      [host({ user: 'ubuntu', identityFiles: ['~/.ssh/id_ed25519'] })],
      { ids: new SequentialIdGenerator('x'), now: 10, groupId: null },
    );
    expect(store.keys[0]?.source).toEqual({ kind: 'path', path: '~/.ssh/id_ed25519' });
    expect(store.identities[0]).toMatchObject({ username: 'ubuntu' });
    expect(store.profiles[0]?.overrides.identityId).toBe(store.identities[0]?.id);
  });

  it('SEC-12 미지원·실행 지시어는 unsupported에 보존만 하고 실행 항목 표시를 남긴다', () => {
    const { store } = importSshConfigHosts(
      emptyProfileStore(),
      [
        host({
          proxyJump: 'bastion',
          unsupported: { proxycommand: 'nc %h %p' },
          needsApproval: ['proxycommand'],
        }),
      ],
      { ids: new SequentialIdGenerator('x'), now: 10, groupId: null },
    );
    expect(store.profiles[0]?.unsupported).toEqual({
      proxycommand: 'nc %h %p',
      proxyjump: 'bastion',
      'btterm:needs-approval': 'proxycommand',
    });
  });

  it('같은 이름·호스트의 프로필이 이미 있으면 건너뛴다', () => {
    const first = importSshConfigHosts(emptyProfileStore(), [host({})], {
      ids: new SequentialIdGenerator('x'),
      now: 10,
      groupId: null,
    });
    const second = importSshConfigHosts(first.store, [host({})], {
      ids: new SequentialIdGenerator('y'),
      now: 20,
      groupId: null,
    });
    expect([second.created, second.skipped, second.store.profiles.length]).toEqual([0, 1, 1]);
  });
});
