import {
  importSshConfigHosts,
  parseSshConfig,
  upsertIdentity,
  type Credential,
  type PassphrasePolicy,
  type GeneratedKeyType,
  type ProfileStore,
  type ResolveInclude,
  type SshConfigFile,
  type SshKey,
} from '@btterm/core';
import type { ProfileRepository } from '../store/ProfileRepository';

export type FullKeyCheck =
  | { ok: true; keyType: string; publicKey: string; fingerprint: string; encrypted: boolean }
  | { ok: false; reason: 'needs-passphrase' | 'bad-passphrase' | 'invalid' };

export type ProfileErrorCode =
  | 'needs-passphrase'
  | 'bad-passphrase'
  | 'key-invalid'
  | 'key-missing'
  | 'key-in-use'
  | 'vault-unavailable'
  | 'not-exportable'
  | 'keygen-failed'
  | 'keygen-busy'
  | 'export-failed'
  | 'not-found';

export class ProfileError extends Error {
  constructor(readonly code: ProfileErrorCode) {
    super(code);
    this.name = 'ProfileError';
  }
}

export interface VaultPort {
  put(plain: Uint8Array): Promise<string>;
  get(ref: string): Promise<Uint8Array>;
  remove(ref: string): Promise<void>;
}

export type IdentityAuth =
  | { kind: 'none' }
  | { kind: 'password'; password?: string | undefined }
  | { kind: 'key'; keyId: string }
  | { kind: 'agent' };

interface ProfileServiceDeps {
  repo: ProfileRepository;
  vault: VaultPort | null;
  readFile(path: string): Promise<Uint8Array>;
  expandHome(path: string): string;
  /** 키 형식·passphrase 확인(session host에서 수행) */
  inspect(privateKey: Uint8Array, passphrase?: string): Promise<FullKeyCheck>;
  /** 키 쌍 생성(session host). OpenSSH 형식 개인키 텍스트를 돌려준다 */
  generate(keyType: GeneratedKeyType, passphrase: string | undefined): Promise<string>;
  ids(): string;
  now(): number;
  passphraseCache: Map<string, string>;
  sshConfig(): Promise<{ files: SshConfigFile[]; resolveInclude: ResolveInclude }>;
}

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * 키·Identity·가져오기처럼 비밀이 얽힌 저장소 변경(F1.4, F6, F7). 비밀은 vault에만 두고
 * profiles.json에는 참조만 남긴다(SEC-1, AC26).
 */
export class ProfileService {
  /** 키 생성 중인지. bcrypt는 session host 이벤트 루프를 막으므로 하나씩만 한다(보안 리뷰 M1) */
  #generating = false;

  constructor(private readonly deps: ProfileServiceDeps) {}

  async addKeyFromPath(
    label: string,
    path: string,
    passphrase: string | undefined,
    policy: PassphrasePolicy,
  ): Promise<{ keyId: string }> {
    let bytes: Uint8Array;
    try {
      bytes = await this.deps.readFile(this.deps.expandHome(path));
    } catch (error) {
      throw new ProfileError(isTooLarge(error) ? 'key-invalid' : 'key-missing');
    }
    return this.#addKey(label, { kind: 'path', path }, bytes, passphrase, policy);
  }

  async importKeyText(
    label: string,
    text: string,
    passphrase: string | undefined,
    policy: PassphrasePolicy,
  ): Promise<{ keyId: string }> {
    const bytes = enc(text);
    await this.#check(bytes, passphrase); // 형식이 틀린 키는 보관소에 넣지 않는다
    const secretRef = await this.#vault().put(bytes);
    return this.#addKey(label, { kind: 'vault', secretRef }, bytes, passphrase, policy);
  }

  /** F7.7: 새 키 쌍을 만들어 보관소에 넣는다. 보관소가 없으면 만들지도 않는다(SEC-2) */
  async generateKey(
    label: string,
    keyType: GeneratedKeyType,
    passphrase: string | undefined,
    policy: PassphrasePolicy,
  ): Promise<{ keyId: string }> {
    this.#vault();
    if (this.#generating) throw new ProfileError('keygen-busy');
    this.#generating = true;
    try {
      const text = await this.deps.generate(keyType, passphrase);
      return await this.importKeyText(label, text, passphrase, policy);
    } finally {
      this.#generating = false;
    }
  }

  /** 보관소 키의 개인키 바이트(파일로 내보내기용, main 안에서만 쓴다). 경로 키는 이미 파일이 있다 */
  async exportKey(keyId: string): Promise<Uint8Array> {
    const key = this.deps.repo.current.keys.find((k) => k.id === keyId);
    if (!key) throw new ProfileError('not-found');
    if (key.source.kind !== 'vault') throw new ProfileError('not-exportable');
    return this.#vault().get(key.source.secretRef);
  }

  /** 처음 사용할 때 확인한 실제 키 정보로 메타데이터를 채운다(ssh_config 가져오기 키). */
  async updateKeyMeta(keyId: string, info: Extract<FullKeyCheck, { ok: true }>): Promise<void> {
    await this.deps.repo.update((s) => ({
      ...s,
      keys: s.keys.map((k) =>
        k.id === keyId
          ? {
              ...k,
              keyType: keyTypeOf(info.keyType),
              publicKey: info.publicKey,
              fingerprintSha256: info.fingerprint,
              encrypted: info.encrypted,
            }
          : k,
      ),
    }));
  }

  async deleteKey(keyId: string): Promise<void> {
    const store = this.deps.repo.current;
    const key = store.keys.find((k) => k.id === keyId);
    if (!key) throw new ProfileError('not-found');
    const credentials = store.credentials.filter(
      (c) => c.type === 'privateKey' && c.keyId === keyId,
    );
    const credentialIds = new Set(credentials.map((c) => c.id));
    if (
      store.identities.some((i) => i.credentialId !== null && credentialIds.has(i.credentialId))
    ) {
      throw new ProfileError('key-in-use');
    }
    await this.deps.repo.update((s) => ({
      ...s,
      keys: s.keys.filter((k) => k.id !== keyId),
      credentials: s.credentials.filter((c) => !credentialIds.has(c.id)),
    }));
    this.deps.passphraseCache.delete(keyId);
    const refs = credentials.flatMap((c) =>
      c.type === 'privateKey' && c.passphraseRef ? [c.passphraseRef] : [],
    );
    if (key.source.kind === 'vault') refs.push(key.source.secretRef);
    await this.#removeSecrets(refs);
  }

  async saveIdentity(
    input: { id?: string | undefined; label: string; username: string },
    auth: IdentityAuth,
  ): Promise<{ identityId: string }> {
    const store = this.deps.repo.current;
    const existing = input.id ? store.identities.find((i) => i.id === input.id) : undefined;
    if (input.id && !existing) throw new ProfileError('not-found');
    const previous = store.credentials.find((c) => c.id === existing?.credentialId);

    const { credential, stale } = await this.#credentialFor(store, auth, previous);
    const identityId = existing?.id ?? this.deps.ids();
    await this.deps.repo.update((s) => {
      let next = s;
      if (credential) {
        next = {
          ...next,
          credentials: [...next.credentials.filter((c) => c.id !== credential.id), credential],
        };
      }
      if (previous?.type === 'password' && previous.id !== credential?.id) {
        next = { ...next, credentials: next.credentials.filter((c) => c.id !== previous.id) };
      }
      return upsertIdentity(next, {
        id: identityId,
        label: input.label,
        username: input.username,
        credentialId: credential?.id ?? null,
      });
    });
    await this.#removeSecrets(stale);
    return { identityId };
  }

  async importSshConfig(): Promise<{ created: number; skipped: number }> {
    const { files, resolveInclude } = await this.deps.sshConfig();
    const hosts = parseSshConfig(files, resolveInclude);
    let result = { created: 0, skipped: 0 };
    await this.deps.repo.update((s) => {
      const imported = importSshConfigHosts(s, hosts, {
        ids: { next: () => this.deps.ids() },
        now: this.deps.now(),
        groupId: null,
      });
      result = { created: imported.created, skipped: imported.skipped };
      return imported.store;
    });
    return result;
  }

  /** 새(또는 갱신한) 자격증명과, 저장 뒤 지울 이전 비밀 참조를 돌려준다. */
  async #credentialFor(
    store: ProfileStore,
    auth: IdentityAuth,
    previous: Credential | undefined,
  ): Promise<{ credential: Credential | null; stale: string[] }> {
    const stalePassword = previous?.type === 'password' ? [previous.secretRef] : [];
    switch (auth.kind) {
      case 'none':
        return { credential: null, stale: stalePassword };
      case 'agent':
        return {
          credential: { id: this.deps.ids(), type: 'agent', agent: 'openssh' },
          stale: stalePassword,
        };
      case 'key': {
        if (!store.keys.some((k) => k.id === auth.keyId)) throw new ProfileError('not-found');
        const shared = store.credentials.find(
          (c) => c.type === 'privateKey' && c.keyId === auth.keyId,
        );
        return {
          credential: shared ?? { id: this.deps.ids(), type: 'privateKey', keyId: auth.keyId },
          stale: stalePassword,
        };
      }
      case 'password': {
        if (auth.password === undefined) {
          // 비밀번호를 바꾸지 않으면 기존 자격증명을 그대로 쓰고, 없으면 접속 때 묻는다.
          return { credential: previous?.type === 'password' ? previous : null, stale: [] };
        }
        const secretRef = await this.#vault().put(enc(auth.password));
        const id = previous?.type === 'password' ? previous.id : this.deps.ids();
        return { credential: { id, type: 'password', secretRef }, stale: stalePassword };
      }
    }
  }

  async #addKey(
    label: string,
    source: SshKey['source'],
    bytes: Uint8Array,
    passphrase: string | undefined,
    policy: PassphrasePolicy,
  ): Promise<{ keyId: string }> {
    const info = await this.#check(bytes, passphrase);
    const keyId = this.deps.ids();
    const storePassphrase = info.encrypted && passphrase !== undefined && policy === 'vault';
    const passphraseRef = storePassphrase ? await this.#vault().put(enc(passphrase)) : undefined;
    const key: SshKey = {
      id: keyId,
      label,
      source,
      keyType: keyTypeOf(info.keyType),
      publicKey: info.publicKey,
      fingerprintSha256: info.fingerprint,
      encrypted: info.encrypted,
      createdAt: this.deps.now(),
    };
    await this.deps.repo.update((s) => ({
      ...s,
      keys: [...s.keys, key],
      credentials: [
        ...s.credentials,
        {
          id: this.deps.ids(),
          type: 'privateKey',
          keyId,
          ...(passphraseRef !== undefined ? { passphraseRef } : {}),
        },
      ],
    }));
    if (info.encrypted && passphrase !== undefined && policy === 'session') {
      this.deps.passphraseCache.set(keyId, passphrase);
    }
    return { keyId };
  }

  async #check(
    bytes: Uint8Array,
    passphrase: string | undefined,
  ): Promise<Extract<FullKeyCheck, { ok: true }>> {
    const result = await this.deps.inspect(bytes, passphrase);
    if (result.ok) return result;
    throw new ProfileError(result.reason === 'invalid' ? 'key-invalid' : result.reason);
  }

  #vault(): VaultPort {
    if (!this.deps.vault) throw new ProfileError('vault-unavailable'); // SEC-2
    return this.deps.vault;
  }

  async #removeSecrets(refs: string[]): Promise<void> {
    if (refs.length === 0) return;
    const vault = this.#vault();
    for (const ref of refs) await vault.remove(ref);
  }
}

/** 크기 상한을 넘은 파일(readLimitedFile): 키가 아니다 */
export function isTooLarge(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'too-large';
}

function keyTypeOf(sshType: string): SshKey['keyType'] {
  if (sshType === 'ssh-rsa') return 'rsa';
  if (sshType.startsWith('ecdsa-')) return 'ecdsa';
  return 'ed25519';
}
