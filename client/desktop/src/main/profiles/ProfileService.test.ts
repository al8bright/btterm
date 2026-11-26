import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProfileRepository } from '../store/ProfileRepository';
import { ProfileService, ProfileError, type FullKeyCheck } from './ProfileService';

let dir: string;
let seq = 0;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-ps-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const enc = (s: string) => new TextEncoder().encode(s);

async function setup(
  options: {
    files?: Record<string, string>;
    sshConfig?: string;
    oversized?: string[];
    noVault?: boolean;
  } = {},
) {
  const generated: Array<{ keyType: string; passphrase?: string | undefined }> = [];
  const secrets = new Map<string, string>();
  const repo = await ProfileRepository.open(join(dir, 'profiles.json'));
  const cache = new Map<string, string>();
  const service = new ProfileService({
    repo,
    vault: options.noVault
      ? null
      : {
          put: async (plain) => {
            const ref = `ref-${++seq}`;
            secrets.set(ref, new TextDecoder().decode(plain));
            return ref;
          },
          get: async (ref) => enc(secrets.get(ref) ?? ''),
          remove: async (ref) => {
            secrets.delete(ref);
          },
        },
    generate: async (keyType, passphrase) => {
      generated.push({ keyType, passphrase });
      return passphrase === undefined ? 'GEN-KEY' : `ENC:${passphrase}`;
    },
    readFile: async (path) => {
      if (options.oversized?.includes(path)) {
        throw Object.assign(new Error('too large'), { code: 'too-large' });
      }
      const content = (options.files ?? {})[path];
      if (content === undefined) throw new Error('ENOENT');
      return enc(content);
    },
    expandHome: (path) => path.replace(/^~\//, 'C:/Users/me/'),
    inspect: async (bytes, passphrase): Promise<FullKeyCheck> => {
      const text = new TextDecoder().decode(bytes);
      const encrypted = text.startsWith('ENC:');
      if (encrypted && passphrase === undefined) return { ok: false, reason: 'needs-passphrase' };
      if (encrypted && passphrase !== text.slice(4)) return { ok: false, reason: 'bad-passphrase' };
      if (text === 'garbage') return { ok: false, reason: 'invalid' };
      return {
        ok: true,
        keyType: 'ssh-ed25519',
        publicKey: 'ssh-ed25519 AAAAPUB',
        fingerprint: 'SHA256:fp',
        encrypted,
      };
    },
    ids: () => `id-${++seq}`,
    now: () => 1000,
    passphraseCache: cache,
    sshConfig: async () => ({
      files: [{ path: 'C:/Users/me/.ssh/config', text: options.sshConfig ?? '' }],
      resolveInclude: () => [],
    }),
  });
  return { service, secrets, cache, repo, generated };
}

describe('ProfileService 키', () => {
  it('F7.1 경로 참조 키를 등록하면 메타데이터만 저장한다', async () => {
    const { service, repo } = await setup({ files: { 'C:/Users/me/.ssh/id': 'KEY' } });
    const { keyId } = await service.addKeyFromPath('ubuntu-key', '~/.ssh/id', undefined, 'ask');
    expect(repo.current.keys.find((k) => k.id === keyId)).toMatchObject({
      source: { kind: 'path', path: '~/.ssh/id' },
      keyType: 'ed25519',
      publicKey: 'ssh-ed25519 AAAAPUB',
      fingerprintSha256: 'SHA256:fp',
      encrypted: false,
    });
  });

  it('F7.3 암호화된 키는 passphrase 없이 등록하면 needs-passphrase', async () => {
    const { service } = await setup({ files: { 'C:/k': 'ENC:pp' } });
    await expect(service.addKeyFromPath('k', 'C:/k', undefined, 'ask')).rejects.toMatchObject({
      code: 'needs-passphrase',
    });
  });

  it('F7.4 passphrase 정책 session은 메모리에만, vault는 보관소에 저장한다', async () => {
    const { service, cache, repo, secrets } = await setup({ files: { 'C:/k': 'ENC:pp' } });
    const session = await service.addKeyFromPath('k1', 'C:/k', 'pp', 'session');
    expect(cache.get(session.keyId)).toBe('pp');

    const vault = await service.addKeyFromPath('k2', 'C:/k', 'pp', 'vault');
    const credential = repo.current.credentials.find(
      (c) => c.type === 'privateKey' && c.keyId === vault.keyId,
    );
    expect(credential?.type === 'privateKey' && secrets.get(credential.passphraseRef ?? '')).toBe(
      'pp',
    );
  });

  it('AC26 텍스트로 가져온 키와 passphrase는 profiles.json에 평문으로 남지 않는다', async () => {
    const { service } = await setup();
    await service.importKeyText('k', 'ENC:pp-secret', 'pp-secret', 'vault');
    await service.saveIdentity(
      { label: 'u', username: 'u' },
      { kind: 'password', password: 'hunter2' },
    );
    for (const name of await readdir(dir)) {
      const text = await readFile(join(dir, name), 'utf8');
      expect(text, name).not.toContain('pp-secret');
      expect(text, name).not.toContain('hunter2');
    }
  });

  it('너무 큰 파일(키가 아님)은 key-invalid(보안 리뷰 #5)', async () => {
    const { service } = await setup({ oversized: ['C:/huge'] });
    await expect(service.addKeyFromPath('k', 'C:/huge', undefined, 'ask')).rejects.toMatchObject({
      code: 'key-invalid',
    });
  });

  it('형식이 아닌 키는 key-invalid', async () => {
    const { service } = await setup({ files: { 'C:/k': 'garbage' } });
    await expect(service.addKeyFromPath('k', 'C:/k', undefined, 'ask')).rejects.toBeInstanceOf(
      ProfileError,
    );
  });

  it('Identity가 쓰는 키는 삭제를 거부하고, 안 쓰는 키는 보관소 비밀까지 지운다', async () => {
    const { service, secrets } = await setup();
    const used = await service.importKeyText('used', 'KEY', undefined, 'ask');
    await service.saveIdentity({ label: 'u', username: 'u' }, { kind: 'key', keyId: used.keyId });
    await expect(service.deleteKey(used.keyId)).rejects.toMatchObject({ code: 'key-in-use' });

    const free = await service.importKeyText('free', 'KEY2', undefined, 'ask');
    const before = secrets.size;
    await service.deleteKey(free.keyId);
    expect(secrets.size).toBe(before - 1);
  });
});

describe('ProfileService 키 생성·내보내기 (F7.7, 결정 TR4)', () => {
  it('session host가 만든 개인키를 보관소에 넣고 공개키 메타데이터만 남긴다', async () => {
    const { service, repo, secrets, generated } = await setup();
    const { keyId } = await service.generateKey('new-key', 'ed25519', 'pp', 'vault');
    expect(generated).toEqual([{ keyType: 'ed25519', passphrase: 'pp' }]);
    const key = repo.current.keys.find((k) => k.id === keyId);
    expect(key).toMatchObject({ label: 'new-key', encrypted: true, source: { kind: 'vault' } });
    expect(key?.source.kind === 'vault' && secrets.get(key.source.secretRef)).toBe('ENC:pp');
  });

  it('SEC-2 보관소를 쓸 수 없으면 키를 만들지도 않는다', async () => {
    const { service, generated } = await setup({ noVault: true });
    await expect(service.generateKey('k', 'rsa', undefined, 'ask')).rejects.toMatchObject({
      code: 'vault-unavailable',
    });
    expect(generated).toEqual([]);
  });

  it('키 생성은 한 번에 하나만 한다(보안 리뷰 M1: session host 부하)', async () => {
    const { service } = await setup();
    const first = service.generateKey('a', 'rsa', undefined, 'ask');
    await expect(service.generateKey('b', 'rsa', undefined, 'ask')).rejects.toMatchObject({
      code: 'keygen-busy',
    });
    await first;
    await expect(service.generateKey('c', 'rsa', undefined, 'ask')).resolves.toHaveProperty(
      'keyId',
    );
  });

  it('보관소 키는 개인키 바이트를 내보내고, 경로 키는 내보내지 않는다', async () => {
    const { service } = await setup({ files: { 'C:/k': 'KEY' } });
    const made = await service.generateKey('k', 'ed25519', undefined, 'ask');
    expect(new TextDecoder().decode(await service.exportKey(made.keyId))).toBe('GEN-KEY');
    const linked = await service.addKeyFromPath('p', 'C:/k', undefined, 'ask');
    await expect(service.exportKey(linked.keyId)).rejects.toMatchObject({
      code: 'not-exportable',
    });
  });
});

describe('ProfileService Identity', () => {
  it('비밀번호 Identity는 보관소에 저장하고, 비밀번호를 바꾸면 이전 비밀을 지운다', async () => {
    const { service, secrets, repo } = await setup();
    const first = await service.saveIdentity(
      { label: 'u', username: 'u' },
      { kind: 'password', password: 'one' },
    );
    await service.saveIdentity(
      { id: first.identityId, label: 'u', username: 'u' },
      { kind: 'password', password: 'two' },
    );
    expect([...secrets.values()]).toEqual(['two']);
    expect(repo.current.identities).toHaveLength(1);
  });

  it('agent Identity를 만든다', async () => {
    const { service, repo } = await setup();
    await service.saveIdentity({ label: 'agent', username: 'u' }, { kind: 'agent' });
    expect(repo.current.credentials[0]).toMatchObject({ type: 'agent', agent: 'openssh' });
  });
});

describe('ProfileService 가져오기', () => {
  it('F1.4 ~/.ssh/config의 Host를 프로필로 가져온다', async () => {
    const { service, repo } = await setup({
      sshConfig: 'Host web-01\n  HostName 10.0.0.5\n  User ubuntu\n  Port 2222\n',
    });
    expect(await service.importSshConfig()).toEqual({ created: 1, skipped: 0 });
    expect(repo.current.profiles[0]).toMatchObject({ name: 'web-01', host: '10.0.0.5' });
  });
});

describe('ProfileService 키 메타데이터', () => {
  it('가져오기로 생긴 빈 메타데이터를 실제 키 정보로 채운다', async () => {
    const { service, repo } = await setup({
      sshConfig: 'Host web\n  HostName 10.0.0.5\n  User u\n  IdentityFile ~/.ssh/id_rsa\n',
    });
    await service.importSshConfig();
    const keyId = repo.current.keys[0]!.id;
    await service.updateKeyMeta(keyId, {
      ok: true,
      keyType: 'ssh-rsa',
      publicKey: 'ssh-rsa AAAAB3',
      fingerprint: 'SHA256:rsa',
      encrypted: true,
    });
    expect(repo.current.keys[0]).toMatchObject({
      keyType: 'rsa',
      publicKey: 'ssh-rsa AAAAB3',
      fingerprintSha256: 'SHA256:rsa',
      encrypted: true,
    });
  });
});
