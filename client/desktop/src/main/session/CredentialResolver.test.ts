import { describe, expect, it } from 'vitest';
import {
  emptyProfileStore,
  type Prompt,
  type PromptResponse,
  type ProfileStore,
} from '@btterm/core';
import { CredentialError, CredentialResolver } from './CredentialResolver';
import type { FullKeyCheck } from '../profiles/ProfileService';

const enc = (s: string) => new TextEncoder().encode(s);

function storeWith(partial: Partial<ProfileStore>): ProfileStore {
  return {
    ...emptyProfileStore(),
    groups: [
      {
        id: 'g',
        parentId: null,
        name: 'Prod',
        order: 0,
        defaults: { port: 2222, keepaliveSec: 15 },
      },
    ],
    profiles: [
      {
        id: 'p1',
        groupId: 'g',
        name: 'web-01',
        host: '10.0.0.5',
        overrides: { identityId: 'i1' },
        tags: [],
        updatedAt: 0,
      },
    ],
    ...partial,
  };
}

function setup(
  store: ProfileStore,
  options: {
    vault?: Record<string, string> | null;
    files?: Record<string, string>;
    encryptedPassphrase?: string; // 키가 암호화돼 있으면 이 passphrase만 통과
    answers?: PromptResponse[];
    agent?: string | null;
    fingerprint?: string;
  } = {},
) {
  const verified: Array<[string, FullKeyCheck]> = [];
  const asked: Prompt[] = [];
  const answers = [...(options.answers ?? [])];
  const cache = new Map<string, string>();
  const resolver = new CredentialResolver({
    store: () => store,
    vault:
      options.vault === null
        ? null
        : {
            get: async (ref: string) => {
              const v = (options.vault ?? {})[ref];
              if (v === undefined) throw new Error('없는 비밀');
              return enc(v);
            },
            has: (ref: string) => (options.vault ?? {})[ref] !== undefined,
          },
    readFile: async (path) => {
      const content = (options.files ?? {})[path];
      if (path.endsWith('huge')) throw Object.assign(new Error('too large'), { code: 'too-large' });
      if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return enc(content);
    },
    expandHome: (path) => path.replace(/^~\//, 'C:/Users/me/'),
    inspect: async (_key, passphrase): Promise<FullKeyCheck> => {
      const info = {
        ok: true as const,
        keyType: 'ssh-ed25519',
        publicKey: 'ssh-ed25519 AAAA',
        fingerprint: options.fingerprint ?? 'SHA256:same',
      };
      if (options.encryptedPassphrase === undefined) return { ...info, encrypted: false };
      if (passphrase === undefined) return { ok: false, reason: 'needs-passphrase' };
      return passphrase === options.encryptedPassphrase
        ? { ...info, encrypted: true }
        : { ok: false, reason: 'bad-passphrase' };
    },
    onKeyVerified: (keyId, info) => verified.push([keyId, info]),
    agentPath: () =>
      options.agent === undefined ? '\\\\.\\pipe\\openssh-ssh-agent' : options.agent,
    passphraseCache: cache,
    ask: async (prompt) => {
      asked.push(prompt);
      return answers.shift() ?? { kind: 'cancel' };
    },
    appDefaults: { port: 22, keepaliveSec: 30 },
  });
  return { resolver, asked, cache, verified };
}

const identity = (credentialId: string | null) => ({
  identities: [{ id: 'i1', label: 'ubuntu', username: 'ubuntu', credentialId }],
});

describe('CredentialResolver', () => {
  it('그룹에서 port·keepalive를, Identity에서 사용자명을 물려받는다', async () => {
    const { resolver } = setup(
      storeWith({
        ...identity('c1'),
        credentials: [{ id: 'c1', type: 'password', secretRef: 'r1' }],
      }),
      { vault: { r1: 'pw' } },
    );
    const params = await resolver.resolve('p1');
    expect(params).toEqual({
      host: '10.0.0.5',
      port: 2222,
      username: 'ubuntu',
      keepaliveSec: 15,
      auth: [{ kind: 'password', password: 'pw' }],
    });
  });

  it('F6.11 연결 직후 명령은 그룹에서 물려받고, 한 줄이 아닌 값은 보내지 않는다', async () => {
    const withCommand = (command: string) =>
      storeWith({
        ...identity('c1'),
        credentials: [{ id: 'c1', type: 'password', secretRef: 'r1' }],
        groups: [
          {
            id: 'g',
            parentId: null,
            name: 'Prod',
            order: 0,
            defaults: { startupCommand: command },
          },
        ],
      });
    const ok = setup(withCommand('cd /srv/app'), { vault: { r1: 'pw' } });
    expect((await ok.resolver.resolve('p1')).startupCommand).toBe('cd /srv/app');
    const bad = setup(withCommand('cd /app\nrm -rf /'), { vault: { r1: 'pw' } });
    expect(await bad.resolver.resolve('p1')).not.toHaveProperty('startupCommand');
  });

  it('자격증명이 없으면 비밀번호를 묻고, 취소하면 cancelled', async () => {
    const ok = setup(storeWith(identity(null)), { answers: [{ kind: 'secret', secret: 'typed' }] });
    expect((await ok.resolver.resolve('p1')).auth).toEqual([
      { kind: 'password', password: 'typed' },
    ]);
    expect(ok.asked[0]).toMatchObject({ kind: 'password', host: '10.0.0.5', username: 'ubuntu' });

    const cancel = setup(storeWith(identity(null)));
    await expect(cancel.resolver.resolve('p1')).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('SEC-2 비밀번호 자격증명인데 보관소를 쓸 수 없으면 vault-unavailable', async () => {
    const { resolver } = setup(
      storeWith({
        ...identity('c1'),
        credentials: [{ id: 'c1', type: 'password', secretRef: 'r1' }],
      }),
      { vault: null },
    );
    await expect(resolver.resolve('p1')).rejects.toMatchObject({ code: 'vault-unavailable' });
  });

  const keyStore = (
    path = '~/.ssh/id_ed25519',
    passphraseRef?: string,
    fingerprint = 'SHA256:same',
  ) =>
    storeWith({
      ...identity('c1'),
      keys: [
        {
          id: 'k1',
          label: 'ubuntu-key',
          source: { kind: 'path', path },
          keyType: 'ed25519',
          publicKey: '',
          fingerprintSha256: fingerprint,
          encrypted: false,
          createdAt: 0,
        },
      ],
      credentials: [
        { id: 'c1', type: 'privateKey', keyId: 'k1', ...(passphraseRef ? { passphraseRef } : {}) },
      ],
    });

  it('보안 리뷰 L10 동기화로 받은 비밀번호 참조가 이 기기 보관소에 없으면 비밀번호를 묻는다', async () => {
    const env = setup(
      storeWith({
        ...identity('c1'),
        credentials: [{ id: 'c1', type: 'password', secretRef: 'gone' }],
      }),
      { vault: {}, answers: [{ kind: 'secret', secret: 'typed' }] },
    );
    expect((await env.resolver.resolve('p1')).auth).toEqual([
      { kind: 'password', password: 'typed' },
    ]);
    expect(env.asked).toEqual([{ kind: 'password', host: '10.0.0.5', username: 'ubuntu' }]);
  });

  it('보안 리뷰 L10 passphrase 참조가 없으면 묻고, 보관소 키 본문이 없으면 key-missing', async () => {
    const env = setup(keyStore('~/.ssh/id_ed25519', 'gone'), {
      files: { 'C:/Users/me/.ssh/id_ed25519': 'KEY' },
      vault: {},
      encryptedPassphrase: 'pp',
      answers: [{ kind: 'secret', secret: 'pp' }],
    });
    expect((await env.resolver.resolve('p1')).auth[0]).toMatchObject({ passphrase: 'pp' });

    const store = keyStore();
    store.keys[0]!.source = { kind: 'vault', secretRef: 'gone' };
    await expect(setup(store, { vault: {} }).resolver.resolve('p1')).rejects.toMatchObject({
      code: 'key-missing',
    });
  });

  it('F7.1 경로 참조 키는 ~를 펼친 경로에서 읽는다', async () => {
    const { resolver } = setup(keyStore(), { files: { 'C:/Users/me/.ssh/id_ed25519': 'KEY' } });
    expect((await resolver.resolve('p1')).auth).toEqual([
      { kind: 'privateKey', privateKey: enc('KEY') },
    ]);
  });

  it('AC28 경로 참조 키 파일이 없으면 접속 전에 key-missing', async () => {
    const { resolver } = setup(keyStore());
    await expect(resolver.resolve('p1')).rejects.toMatchObject({ code: 'key-missing' });
  });

  it('키 경로가 너무 큰 파일이면 key-invalid(보안 리뷰 #5)', async () => {
    const { resolver } = setup(keyStore('C:/huge'));
    await expect(resolver.resolve('p1')).rejects.toMatchObject({ code: 'key-invalid' });
  });

  it('AC27 암호화된 키는 passphrase를 묻고 앱 실행 동안 기억한다', async () => {
    const env = setup(keyStore(), {
      files: { 'C:/Users/me/.ssh/id_ed25519': 'KEY' },
      encryptedPassphrase: 'pp',
      answers: [{ kind: 'secret', secret: 'pp' }],
    });
    const first = await env.resolver.resolve('p1');
    const second = await env.resolver.resolve('p1');
    expect(first.auth).toEqual([{ kind: 'privateKey', privateKey: enc('KEY'), passphrase: 'pp' }]);
    expect(second.auth).toEqual(first.auth);
    expect(env.asked.filter((p) => p.kind === 'passphrase')).toHaveLength(1);
  });

  it('보관소에 저장된 passphrase가 있으면 묻지 않는다', async () => {
    const env = setup(keyStore('~/.ssh/id_ed25519', 'pref'), {
      files: { 'C:/Users/me/.ssh/id_ed25519': 'KEY' },
      vault: { pref: 'pp' },
      encryptedPassphrase: 'pp',
    });
    expect((await env.resolver.resolve('p1')).auth[0]).toMatchObject({ passphrase: 'pp' });
    expect(env.asked).toEqual([]);
  });

  it('passphrase가 세 번 틀리면 bad-passphrase', async () => {
    const env = setup(keyStore(), {
      files: { 'C:/Users/me/.ssh/id_ed25519': 'KEY' },
      encryptedPassphrase: 'pp',
      answers: [1, 2, 3].map(() => ({ kind: 'secret' as const, secret: 'x' })),
    });
    await expect(env.resolver.resolve('p1')).rejects.toMatchObject({ code: 'bad-passphrase' });
  });

  it('F2.2 agent 자격증명은 agent 경로를 쓰고, 경로가 없으면 agent-unavailable', async () => {
    const store = storeWith({
      ...identity('c1'),
      credentials: [{ id: 'c1', type: 'agent', agent: 'openssh' }],
    });
    expect((await setup(store).resolver.resolve('p1')).auth).toEqual([
      { kind: 'agent', agentPath: '\\\\.\\pipe\\openssh-ssh-agent' },
    ]);
    await expect(setup(store, { agent: null }).resolver.resolve('p1')).rejects.toBeInstanceOf(
      CredentialError,
    );
  });

  it('F7.6 경로 참조 키의 지문이 등록 때와 다르면 접속 전에 key-changed', async () => {
    const env = setup(keyStore(), {
      files: { 'C:/Users/me/.ssh/id_ed25519': 'KEY' },
      fingerprint: 'SHA256:other',
    });
    await expect(env.resolver.resolve('p1')).rejects.toMatchObject({ code: 'key-changed' });
  });

  it('지문이 비어 있는 키(ssh_config 가져오기)는 처음 쓸 때 메타데이터를 채운다', async () => {
    const env = setup(keyStore('~/.ssh/id_ed25519', undefined, ''), {
      files: { 'C:/Users/me/.ssh/id_ed25519': 'KEY' },
      fingerprint: 'SHA256:new',
    });
    await env.resolver.resolve('p1');
    expect(env.verified).toEqual([['k1', expect.objectContaining({ fingerprint: 'SHA256:new' })]]);
  });

  it('사용자명을 알 수 없으면 no-username', async () => {
    const store = storeWith({});
    store.profiles[0]!.overrides = {};
    await expect(setup(store).resolver.resolve('p1')).rejects.toMatchObject({
      code: 'no-username',
    });
  });
});
