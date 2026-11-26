import type { IdGenerator } from '../id/IdGenerator';
import type { SshConfigHost } from '../import/sshConfig';
import type { Group, Identity, Profile, ProfileStore, SshKey } from './model';
import { groupChain } from './settings';

// 프로필 저장소에 대한 순수 변경 함수. 원본을 바꾸지 않고 새 저장소를 돌려준다.

function replaceById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index < 0) return [...list, item];
  return list.map((x, i) => (i === index ? item : x));
}

function assertGroup(store: ProfileStore, groupId: string | null): void {
  if (groupId !== null && !store.groups.some((g) => g.id === groupId)) {
    throw new Error(`없는 그룹: ${groupId}`);
  }
}

export function upsertProfile(store: ProfileStore, profile: Profile): ProfileStore {
  assertGroup(store, profile.groupId);
  return { ...store, profiles: replaceById(store.profiles, profile) };
}

export function removeProfile(store: ProfileStore, profileId: string): ProfileStore {
  return { ...store, profiles: store.profiles.filter((p) => p.id !== profileId) };
}

export function touchRecent(store: ProfileStore, profileId: string, now: number): ProfileStore {
  return {
    ...store,
    profiles: store.profiles.map((p) => (p.id === profileId ? { ...p, lastConnectedAt: now } : p)),
  };
}

export function upsertGroup(store: ProfileStore, group: Group): ProfileStore {
  assertGroup(store, group.parentId);
  const next = { ...store, groups: replaceById(store.groups, group) };
  groupChain(group.id, next.groups); // 순환이면 예외
  return next;
}

/** 그룹을 지우면 하위 그룹·프로필은 지운 그룹의 부모로 올린다. */
export function removeGroup(store: ProfileStore, groupId: string): ProfileStore {
  const target = store.groups.find((g) => g.id === groupId);
  if (!target) return store;
  const parent = target.parentId;
  return {
    ...store,
    groups: store.groups
      .filter((g) => g.id !== groupId)
      .map((g) => (g.parentId === groupId ? { ...g, parentId: parent } : g)),
    profiles: store.profiles.map((p) => (p.groupId === groupId ? { ...p, groupId: parent } : p)),
  };
}

export function upsertIdentity(store: ProfileStore, identity: Identity): ProfileStore {
  if (
    identity.credentialId !== null &&
    !store.credentials.some((c) => c.id === identity.credentialId)
  ) {
    throw new Error(`없는 자격증명: ${identity.credentialId}`);
  }
  return { ...store, identities: replaceById(store.identities, identity) };
}

export interface ImportOptions {
  ids: IdGenerator;
  now: number;
  groupId: string | null;
}

/**
 * ssh_config 가져오기 결과를 프로필로 옮긴다(F1.4). IdentityFile은 경로 참조 키로만 등록하고
 * 키 내용은 읽지 않는다. 키 형식 검증은 처음 쓸 때 session host가 한다.
 */
export function importSshConfigHosts(
  store: ProfileStore,
  hosts: readonly SshConfigHost[],
  options: ImportOptions,
): { store: ProfileStore; created: number; skipped: number } {
  let next = store;
  let created = 0;
  let skipped = 0;
  for (const host of hosts) {
    if (next.profiles.some((p) => p.name === host.alias && p.host === host.hostName)) {
      skipped += 1;
      continue;
    }
    let identityId: string | undefined;
    const keyPath = host.identityFiles[0];
    if (keyPath !== undefined) {
      const key = pathKey(next, keyPath, options);
      if (!next.keys.some((k) => k.id === key.id)) next = { ...next, keys: [...next.keys, key] };
      const credentialId = options.ids.next();
      identityId = options.ids.next();
      next = {
        ...next,
        credentials: [...next.credentials, { id: credentialId, type: 'privateKey', keyId: key.id }],
        identities: [
          ...next.identities,
          {
            id: identityId,
            label: `${host.user ?? ''}@${keyPath}`,
            username: host.user ?? '',
            credentialId,
          },
        ],
      };
    }
    const unsupported: Record<string, string> = { ...host.unsupported };
    if (host.proxyJump !== null) unsupported.proxyjump = host.proxyJump;
    if (host.needsApproval.length > 0) {
      unsupported['btterm:needs-approval'] = host.needsApproval.join(',');
    }
    const profile: Profile = {
      id: options.ids.next(),
      groupId: options.groupId,
      name: host.alias,
      host: host.hostName,
      overrides: {
        ...(host.port !== null ? { port: host.port } : {}),
        ...(host.user !== null ? { username: host.user } : {}),
        ...(host.keepaliveSec !== null ? { keepaliveSec: host.keepaliveSec } : {}),
        ...(identityId !== undefined ? { identityId } : {}),
      },
      tags: [],
      updatedAt: options.now,
      ...(Object.keys(unsupported).length > 0 ? { unsupported } : {}),
    };
    next = upsertProfile(next, profile);
    created += 1;
  }
  return { store: next, created, skipped };
}

function pathKey(store: ProfileStore, path: string, options: ImportOptions): SshKey {
  const existing = store.keys.find((k) => k.source.kind === 'path' && k.source.path === path);
  if (existing) return existing;
  return {
    id: options.ids.next(),
    label: path,
    source: { kind: 'path', path },
    keyType: 'ed25519', // 처음 사용할 때 실제 형식으로 갱신한다
    publicKey: '',
    fingerprintSha256: '',
    encrypted: false,
    createdAt: options.now,
  };
}
