import {
  groupChain,
  resolveEffectiveSettings,
  type AppDefaults,
  type AuthMethod,
  type Credential,
  type ProfileStore,
  type Prompt,
  type PromptResponse,
  type SshKey,
  StartupCommandSchema,
} from '@btterm/core';
import { isTooLarge, type FullKeyCheck } from '../profiles/ProfileService';
import type { SessionParams } from './SessionSupervisor';

type KeyInfo = Extract<FullKeyCheck, { ok: true }>;

export type CredentialErrorCode =
  | 'no-profile'
  | 'no-username'
  | 'vault-unavailable'
  | 'key-missing'
  | 'key-invalid'
  | 'key-changed'
  | 'bad-passphrase'
  | 'agent-unavailable'
  | 'cancelled';

export class CredentialError extends Error {
  constructor(readonly code: CredentialErrorCode) {
    super(code);
    this.name = 'CredentialError';
  }
}

interface ResolverDeps {
  store(): ProfileStore;
  vault: { get(ref: string): Promise<Uint8Array>; has(ref: string): boolean } | null;
  readFile(path: string): Promise<Uint8Array>;
  expandHome(path: string): string;
  /** 키 형식·passphrase 확인(session host에서 수행) */
  inspect(privateKey: Uint8Array, passphrase?: string): Promise<FullKeyCheck>;
  /** 메타데이터가 비어 있던 키(ssh_config 가져오기)를 처음 확인했을 때 */
  onKeyVerified?(keyId: string, info: KeyInfo): void;
  agentPath(): string | null;
  /** keyId → passphrase. 앱 실행 동안만 메모리에 둔다(F6.8). */
  passphraseCache: Map<string, string>;
  ask(prompt: Prompt): Promise<PromptResponse>;
  appDefaults: AppDefaults;
}

const MAX_PASSPHRASE_TRIES = 3;

/**
 * 프로필에서 접속 파라미터를 만든다(F2.1, F2.2, F7). 비밀은 main 메모리에서만 다루고
 * session host로 한 번 넘긴다(SEC-1).
 */
export class CredentialResolver {
  constructor(private readonly deps: ResolverDeps) {}

  async resolve(profileId: string): Promise<SessionParams> {
    const store = this.deps.store();
    const profile = store.profiles.find((p) => p.id === profileId);
    if (!profile) throw new CredentialError('no-profile');
    const { values } = resolveEffectiveSettings(
      profile,
      groupChain(profile.groupId, store.groups),
      this.deps.appDefaults,
    );
    const identity = store.identities.find((i) => i.id === values.identityId);
    const username = values.username ?? identity?.username;
    if (!username) throw new CredentialError('no-username');
    const credential = store.credentials.find((c) => c.id === identity?.credentialId);
    const auth = await this.#auth(store, credential, profile.host, username);
    const startup = StartupCommandSchema.safeParse(values.startupCommand);
    return {
      host: profile.host,
      port: values.port,
      username,
      keepaliveSec: values.keepaliveSec,
      auth,
      ...(startup.success ? { startupCommand: startup.data } : {}),
    };
  }

  async #auth(
    store: ProfileStore,
    credential: Credential | undefined,
    host: string,
    username: string,
  ): Promise<AuthMethod[]> {
    if (!credential) {
      const answer = await this.deps.ask({ kind: 'password', host, username });
      if (answer.kind !== 'secret') throw new CredentialError('cancelled');
      return [{ kind: 'password', password: answer.secret }];
    }
    if (credential.type === 'password') {
      // 동기화로 받은 참조인데 비밀이 아직 없으면(보류 등) 저장하지 않은 것처럼 묻는다(보안 리뷰 L10)
      const password = await this.#secret(credential.secretRef);
      if (password !== null) return [{ kind: 'password', password }];
      return this.#auth(store, undefined, host, username);
    }
    if (credential.type === 'agent') {
      const agentPath = this.deps.agentPath();
      if (!agentPath) throw new CredentialError('agent-unavailable');
      return [{ kind: 'agent', agentPath }];
    }
    const key = store.keys.find((k) => k.id === credential.keyId);
    if (!key) throw new CredentialError('key-missing');
    const privateKey = await this.#keyBytes(key);
    const { passphrase, info } = await this.#unlock(key, privateKey, credential.passphraseRef);
    this.#checkFingerprint(key, info);
    return [
      {
        kind: 'privateKey',
        privateKey,
        ...(passphrase !== undefined ? { passphrase } : {}),
      },
    ];
  }

  /** 보관소에 없는 참조면 null */
  async #secret(ref: string): Promise<string | null> {
    if (!this.deps.vault) throw new CredentialError('vault-unavailable');
    if (!this.deps.vault.has(ref)) return null;
    return new TextDecoder().decode(await this.deps.vault.get(ref));
  }

  async #keyBytes(key: SshKey): Promise<Uint8Array> {
    if (key.source.kind === 'vault') {
      if (!this.deps.vault) throw new CredentialError('vault-unavailable');
      if (!this.deps.vault.has(key.source.secretRef)) throw new CredentialError('key-missing');
      return this.deps.vault.get(key.source.secretRef);
    }
    try {
      return await this.deps.readFile(this.deps.expandHome(key.source.path));
    } catch (error) {
      throw new CredentialError(isTooLarge(error) ? 'key-invalid' : 'key-missing'); // F7.6, AC28
    }
  }

  /** F7.6: 경로 참조 키 파일이 바뀌었으면 접속 전에 막는다. 지문이 없던 키는 이번에 채운다. */
  #checkFingerprint(key: SshKey, info: KeyInfo): void {
    if (key.fingerprintSha256 === '') {
      this.deps.onKeyVerified?.(key.id, info);
      return;
    }
    if (key.source.kind === 'path' && info.fingerprint !== key.fingerprintSha256) {
      throw new CredentialError('key-changed');
    }
  }

  async #unlock(
    key: SshKey,
    privateKey: Uint8Array,
    passphraseRef: string | undefined,
  ): Promise<{ passphrase: string | undefined; info: KeyInfo }> {
    const plain = await this.deps.inspect(privateKey);
    if (plain.ok) return { passphrase: undefined, info: plain };
    if (plain.reason === 'invalid') throw new CredentialError('key-invalid');

    const known =
      (passphraseRef !== undefined ? await this.#secret(passphraseRef) : null) ??
      this.deps.passphraseCache.get(key.id);
    if (known !== undefined) {
      const checked = await this.deps.inspect(privateKey, known);
      if (checked.ok) return { passphrase: known, info: checked };
    }

    for (let i = 0; i < MAX_PASSPHRASE_TRIES; i++) {
      const answer = await this.deps.ask({ kind: 'passphrase', keyLabel: key.label });
      if (answer.kind !== 'secret') throw new CredentialError('cancelled');
      const checked = await this.deps.inspect(privateKey, answer.secret);
      if (checked.ok) {
        this.deps.passphraseCache.set(key.id, answer.secret);
        return { passphrase: answer.secret, info: checked };
      }
    }
    throw new CredentialError('bad-passphrase');
  }
}
