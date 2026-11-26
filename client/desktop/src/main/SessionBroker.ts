import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import {
  BrowserWindow,
  dialog,
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import {
  HistoryResultSchema,
  StatsResultSchema,
  HostToMainControlSchema,
  MainToHostControlSchema,
  moveTreeItem,
  MainToRendererEventSchema,
  ReconnectPolicy,
  ResourceTracker,
  toProfilesView,
  touchRecent,
  upsertGroup,
  upsertProfile,
  removeGroup,
  removeProfile,
  type AuthMethod,
  type GeneratedKeyType,
  type HistoryResult,
  type StatsResult,
  type HostToMainControl,
  type MainToHostControl,
  type MainToRendererEvent,
  type RendererToMainRequest,
  type SessionState,
  type SshErrorCode,
} from '@btterm/core';
import {
  defaultKeyExportPath,
  expandHome,
  isWindowsNetworkPath,
  localPlatform,
  sshAgentPath,
} from '../platform/paths';
import { openLocalFile } from './external/openExternal';
import { watchFile } from './files/watchFile';
import { loadSshConfig } from '../platform/sshConfigFiles';
import { IPC } from '../shared/api';
import { nodeClock } from '../shared/nodeClock';
import { fingerprintOf, type KnownHostsStore } from './hostkeys/KnownHostsStore';
import { removalDialogOptions } from './hostkeys/removalDialog';
import type { AppLogger } from './logging/AppLogger';
import { ProfileError, ProfileService, type FullKeyCheck } from './profiles/ProfileService';
import { DroppedPaths } from './files/DroppedPaths';
import { FileRelay } from './files/FileRelay';
import { MAX_KEY_FILE_BYTES, readLimitedFile } from './files/readLimited';
import { PromptBroker } from './PromptBroker';
import { CredentialError, CredentialResolver } from './session/CredentialResolver';
import { SessionSupervisor, type EmitExtra, type SessionParams } from './session/SessionSupervisor';
import type { ProfileRepository } from './store/ProfileRepository';
import type { SecretVault } from './vault/SecretVault';

interface SessionBrokerOptions {
  sessionHostPath: string;
  /** 로컬 편집 임시 폴더(앱 데이터 아래, F4.8). 시작할 때 비운다 */
  editDir: string;
  knownHosts: KnownHostsStore;
  repo: ProfileRepository;
  vault: SecretVault | null;
  logger?: AppLogger;
}

const INITIAL_SIZE = { cols: 80, rows: 24 };
const APP_DEFAULTS = { port: 22, keepaliveSec: 30 };

/**
 * main 프로세스의 세션 중개자(D5). session host(utilityProcess)를 띄우고,
 * 세션마다 MessagePort를 만들어 renderer와 session host를 직결한다. 바이트는 main을 거치지 않는다.
 * 비밀(비밀번호·키·passphrase)은 main 메모리에서 session host로만 넘긴다(SEC-1).
 */
export class SessionBroker {
  readonly #host: UtilityProcess;
  readonly #options: SessionBrokerOptions;
  readonly #prompts = new PromptBroker();
  readonly #senders = new Map<string, WebContents>();
  /** 탭을 닫았지만 아직 끝나지 않은 세션. 늦게 온 확인 요청은 확인창 없이 거부한다(보안 리뷰) */
  readonly #closing = new Set<string>();
  readonly #windows = new Set<WebContents>();
  readonly #pendingKeyInfo = new Map<string, (result: FullKeyCheck) => void>();
  readonly #pendingKeyGen = new Map<string, (result: KeyGenResult) => void>();
  readonly #pendingHistory = new Map<string, (result: HistoryResult) => void>();
  readonly #pendingStats = new Map<string, (result: StatsResult) => void>();
  /** 끝난 세션을 수동으로 다시 열 때 인증 정보를 다시 받는 방법(보안 리뷰 #7) */
  readonly #reauth = new Map<string, () => Promise<AuthMethod[] | null>>();
  /** keyId → passphrase. 앱 실행 동안만 메모리에 둔다(F6.8). */
  readonly #passphrases = new Map<string, string>();
  readonly #tracker = new ResourceTracker();
  readonly #supervisor: SessionSupervisor;
  readonly #profiles: ProfileService;
  readonly #files: FileRelay;
  readonly #dropped = new DroppedPaths(() => Date.now());

  constructor(options: SessionBrokerOptions) {
    this.#options = options;
    this.#host = utilityProcess.fork(options.sessionHostPath, [], {
      serviceName: 'btterm-session-host',
    });
    this.#host.on('message', (raw: unknown) => void this.#onHostMessage(raw));
    this.#host.on('exit', () => {
      // 응답이 오지 않을 요청을 모두 끝낸다(보안 리뷰 #4).
      for (const settle of [...this.#pendingHistory.values()]) {
        settle({ status: 'unavailable', entries: [] });
      }
      for (const settle of [...this.#pendingStats.values()]) settle({ status: 'unavailable' });
      for (const settle of [...this.#pendingKeyInfo.values()])
        settle({ ok: false, reason: 'invalid' });
      for (const settle of [...this.#pendingKeyGen.values()]) settle({ ok: false });
      this.#files.failAll('unavailable');
      this.#prompts.cancelAll();
      for (const sessionId of [...this.#senders.keys()]) {
        this.#supervisor.forget(sessionId);
        this.#emitState(sessionId, 'failed', { errorCode: 'unknown' });
      }
    });

    this.#supervisor = new SessionSupervisor({
      clock: nodeClock,
      tracker: this.#tracker,
      policy: new ReconnectPolicy(),
      start: (sessionId, params) => this.#start(sessionId, params),
      emit: (sessionId, state, extra) => this.#emitState(sessionId, state, extra),
      refreshAuth: (sessionId) => this.#reauth.get(sessionId)?.() ?? Promise.resolve(null),
    });

    // 지난 실행이 비정상 종료로 남긴 편집 임시 파일을 지운다
    const staleEditsCleared = rm(options.editDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    this.#files = new FileRelay({
      post: (message) => this.#post(message),
      ownerOf: (sessionId) => this.#senders.get(sessionId),
      isReady: (sessionId) => this.#supervisor.readySessions().includes(sessionId),
      ask: (sender, prompt) => this.#prompts.request(sender, prompt),
      send: (sender, event) => this.#send(sender, event),
      chooseFolder: async (sender) => {
        const result = await openDialog(sender, ['openDirectory', 'createDirectory']);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      chooseFiles: async (sender) => {
        const result = await openDialog(sender, ['openFile', 'multiSelections']);
        return result.canceled ? [] : result.filePaths;
      },
      consumeDropped: (sender, paths) => this.#dropped.consume(sender, paths),
      edits: {
        tempRoot: options.editDir,
        platform: localPlatform(),
        openPath: openLocalFile,
        isFile: async (path) => (await lstat(path).catch(() => null))?.isFile() ?? false,
        watch: watchFile,
        // 지우기가 끝난 뒤에 만들어야 새 편집 폴더가 지워지지 않는다(보안 리뷰 L4)
        makeDir: async (path) => {
          await staleEditsCleared;
          await mkdir(path, { recursive: true });
        },
        remove: (path) => rm(path, { recursive: true, force: true }),
      },
    });

    this.#profiles = new ProfileService({
      repo: options.repo,
      vault: options.vault,
      readFile: readKeyFile,
      expandHome,
      inspect: (privateKey, passphrase) => this.#inspect(privateKey, passphrase),
      generate: (keyType, passphrase) => this.#generateKey(keyType, passphrase),
      ids: () => randomUUID(),
      now: () => Date.now(),
      passphraseCache: this.#passphrases,
      sshConfig: () => loadSshConfig(),
    });
  }

  async handle(sender: WebContents, request: RendererToMainRequest): Promise<unknown> {
    this.#track(sender);
    try {
      return await this.#dispatch(sender, request);
    } catch (error) {
      if (error instanceof ProfileError || error instanceof CredentialError) {
        return { ok: false, error: error.code };
      }
      throw error;
    }
  }

  /** preload가 webUtils로 얻은 드롭 경로를 등록한다(renderer가 지어낸 경로는 업로드 불가). */
  registerDropped(sender: WebContents, path: string): void {
    this.#track(sender);
    this.#dropped.register(sender, path);
  }

  /** 절전 복귀·잠금 해제 뒤 살아 있는 세션을 확인한다(F6.6). 죽었으면 host가 재접속을 유도한다. */
  /** 동기화로 서버 목록이 바뀌었을 때 화면에 알린다(F8.5) */
  profilesChanged(): void {
    this.#changed({});
  }

  probeAll(): void {
    for (const sessionId of this.#supervisor.readySessions()) {
      this.#post({ type: 'probe', sessionId });
    }
  }

  dispose(): void {
    this.#supervisor.dispose();
    this.#host.kill();
  }

  async #dispatch(sender: WebContents, request: RendererToMainRequest): Promise<unknown> {
    if (this.#files.handles(request)) return this.#files.handle(sender, request);
    const repo = this.#options.repo;
    switch (request.type) {
      case 'profiles.get':
        return toProfilesView(repo.current);
      case 'profiles.saveProfile':
        return this.#mutate((s) => upsertProfile(s, request.profile));
      case 'profiles.deleteProfile':
        return this.#mutate((s) => removeProfile(s, request.profileId));
      case 'profiles.saveGroup':
        return this.#mutate((s) => upsertGroup(s, request.group));
      case 'profiles.deleteGroup':
        return this.#mutate((s) => removeGroup(s, request.groupId));
      case 'profiles.move':
        return this.#mutate((s) => moveTreeItem(s, request.item, request.parentId, request.index));
      case 'profiles.saveIdentity':
        return this.#changed(await this.#profiles.saveIdentity(request.identity, request.auth));
      case 'keys.addFromPath':
        return this.#changed(
          await this.#profiles.addKeyFromPath(
            request.label,
            request.path,
            request.passphrase,
            request.passphrasePolicy,
          ),
        );
      case 'keys.importText':
        return this.#changed(
          await this.#profiles.importKeyText(
            request.label,
            request.text,
            request.passphrase,
            request.passphrasePolicy,
          ),
        );
      case 'keys.generate':
        return this.#changed(
          await this.#profiles.generateKey(
            request.label,
            request.keyType,
            request.passphrase,
            request.passphrasePolicy,
          ),
        );
      case 'knownHosts.list':
        return { entries: await this.#options.knownHosts.list() };
      case 'knownHosts.remove':
        return {
          ok: await this.#options.knownHosts.remove(request, async (entry) => {
            const options = removalDialogOptions(entry);
            const win = BrowserWindow.fromWebContents(sender);
            const { response } = win
              ? await dialog.showMessageBox(win, options)
              : await dialog.showMessageBox(options);
            return response === 1;
          }),
        };
      case 'keys.install': {
        const key = this.#options.repo.current.keys.find((k) => k.id === request.keyId);
        if (!key?.publicKey) return { ok: false, error: 'not-found' };
        return this.#files.installKey(sender, request.sessionId, key.publicKey);
      }
      case 'keys.export':
        return this.#exportKey(sender, request.keyId);
      case 'keys.delete':
        await this.#profiles.deleteKey(request.keyId);
        return this.#changed({});
      case 'import.sshConfig':
        return this.#changed(await this.#profiles.importSshConfig());
      case 'session.openProfile':
        return this.#openProfile(sender, request.profileId);
      case 'history.load':
        return this.#loadHistory(sender, request.sessionId);
      case 'stats.read':
        return this.#readStats(sender, request.sessionId);
      case 'session.reconnect':
        if (this.#senders.get(request.sessionId) !== sender)
          return { ok: false, error: 'not-found' };
        void this.#supervisor.reconnectNow(request.sessionId);
        return { ok: true };
      case 'session.openQuick':
        return this.#openQuick(sender, request);
      case 'session.close':
        if (this.#senders.get(request.sessionId) !== sender)
          return { ok: false, error: 'not-found' };
        this.#closing.add(request.sessionId);
        this.#supervisor.close(request.sessionId);
        this.#prompts.cancelSession(request.sessionId);
        void this.#files.sessionClosed(request.sessionId);
        this.#post({ type: 'close', sessionId: request.sessionId });
        if (!this.#supervisor.has(request.sessionId)) this.#forgetSession(request.sessionId);
        return { ok: true };
      case 'prompt.respond':
        this.#prompts.respond(request.promptId, request.response, sender);
        return { ok: true };
    }
  }

  async #mutate(change: Parameters<ProfileRepository['update']>[0]): Promise<{ ok: true }> {
    await this.#options.repo.update(change);
    return this.#changed({});
  }

  #changed<T extends object>(result: T): T & { ok: true } {
    this.#broadcast({ type: 'profiles.changed', view: toProfilesView(this.#options.repo.current) });
    return { ...result, ok: true };
  }

  async #openProfile(sender: WebContents, profileId: string): Promise<{ sessionId: string }> {
    const params = await this.#resolver(sender).resolve(profileId);
    await this.#options.repo.update((s) => touchRecent(s, profileId, Date.now()));
    this.#changed({});
    const sessionId = this.#open(sender, params);
    this.#reauth.set(sessionId, () =>
      this.#resolver(sender, sessionId)
        .resolve(profileId)
        .then(
          (p) => p.auth,
          () => null,
        ),
    );
    return { sessionId };
  }

  /** sessionId: 재접속 때 묻는 키 암호처럼 세션에 딸린 확인창(세션이 끝나면 취소, DF1) */
  #resolver(sender: WebContents, sessionId?: string): CredentialResolver {
    return new CredentialResolver({
      store: () => this.#options.repo.current,
      vault: this.#options.vault,
      readFile: readKeyFile,
      expandHome,
      inspect: (privateKey, passphrase) => this.#inspect(privateKey, passphrase),
      agentPath: sshAgentPath,
      passphraseCache: this.#passphrases,
      onKeyVerified: (keyId, info) => {
        void this.#profiles.updateKeyMeta(keyId, info).then(() => this.#changed({}));
      },
      ask: (prompt) => this.#prompts.request(sender, prompt, sessionId),
      appDefaults: APP_DEFAULTS,
    });
  }

  async #openQuick(
    sender: WebContents,
    request: Extract<RendererToMainRequest, { type: 'session.openQuick' }>,
  ): Promise<{ sessionId: string | null }> {
    const askPassword = async (sessionId?: string): Promise<AuthMethod[] | null> => {
      const answer = await this.#prompts.request(
        sender,
        { kind: 'password', host: request.host, username: request.username },
        sessionId,
      );
      return answer.kind === 'secret' ? [{ kind: 'password', password: answer.secret }] : null;
    };
    const auth = await askPassword();
    if (!auth) return { sessionId: null };
    const sessionId = this.#open(sender, {
      host: request.host,
      port: request.port,
      username: request.username,
      keepaliveSec: APP_DEFAULTS.keepaliveSec,
      auth,
    });
    this.#reauth.set(sessionId, () => askPassword(sessionId));
    return { sessionId };
  }

  #open(sender: WebContents, params: SessionParams): string {
    const sessionId = randomUUID();
    this.#senders.set(sessionId, sender);
    this.#supervisor.open(sessionId, params);
    return sessionId;
  }

  /** 같은 sessionId로 새 포트를 만들어 session host에 연다(최초 접속과 재접속 공통). */
  #start(sessionId: string, params: SessionParams): void {
    const sender = this.#senders.get(sessionId);
    if (!sender || sender.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    sender.postMessage(IPC.port, { sessionId }, [port2]);
    this.#post({ type: 'open', sessionId, ...params, size: INITIAL_SIZE }, [port1]);
  }

  /** 원격 셸 기록(F3.17a). 이 창이 연 ready 세션만. */
  #loadHistory(sender: WebContents, sessionId: string): Promise<HistoryResult> {
    if (
      this.#senders.get(sessionId) !== sender ||
      !this.#supervisor.readySessions().includes(sessionId)
    ) {
      return Promise.resolve({ status: 'unavailable', entries: [] });
    }
    return awaitReply(
      this.#pendingHistory,
      (requestId) => this.#post({ type: 'readHistory', requestId, sessionId }),
      { status: 'unavailable', entries: [] },
      HISTORY_TIMEOUT_MS,
    ).then((result) => HistoryResultSchema.parse(result));
  }

  /** 서버 상태 줄(F3.18). 이 창이 연 ready 세션만. */
  #readStats(sender: WebContents, sessionId: string): Promise<StatsResult> {
    if (
      this.#senders.get(sessionId) !== sender ||
      !this.#supervisor.readySessions().includes(sessionId)
    ) {
      return Promise.resolve({ status: 'unavailable' });
    }
    return awaitReply(
      this.#pendingStats,
      (requestId) => this.#post({ type: 'readStats', requestId, sessionId }),
      { status: 'unavailable' },
      STATS_TIMEOUT_MS,
    ).then((result) => StatsResultSchema.parse(result));
  }

  #inspect(privateKey: Uint8Array, passphrase?: string): Promise<FullKeyCheck> {
    return awaitReply(
      this.#pendingKeyInfo,
      (requestId) =>
        this.#post({
          type: 'inspectKey',
          requestId,
          privateKey,
          ...(passphrase !== undefined ? { passphrase } : {}),
        }),
      { ok: false, reason: 'invalid' },
      KEY_INFO_TIMEOUT_MS,
    );
  }

  /** F7.7: 개인키 텍스트는 session host → main으로만 오고 renderer로 가지 않는다(SEC-1) */
  async #generateKey(keyType: GeneratedKeyType, passphrase: string | undefined): Promise<string> {
    const result = await awaitReply<KeyGenResult>(
      this.#pendingKeyGen,
      (requestId) =>
        this.#post({
          type: 'generateKey',
          requestId,
          keyType,
          comment: '',
          ...(passphrase !== undefined ? { passphrase } : {}),
        }),
      { ok: false },
      KEY_GEN_TIMEOUT_MS,
    );
    if (!result.ok) throw new ProfileError('keygen-failed');
    return result.privateKey;
  }

  /** 보관소 키를 사용자가 고른 파일로 쓴다. 개인키는 renderer를 거치지 않는다 */
  async #exportKey(sender: WebContents, keyId: string): Promise<{ exported: boolean }> {
    const bytes = await this.#profiles.exportKey(keyId);
    const win = BrowserWindow.fromWebContents(sender);
    const options = { defaultPath: defaultKeyExportPath() };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { exported: false };
    try {
      await writeFile(result.filePath, bytes, { mode: 0o600 });
    } catch {
      throw new ProfileError('export-failed'); // 경로가 든 OS 오류 메시지를 renderer로 넘기지 않는다
    }
    return { exported: true };
  }

  async #onHostMessage(raw: unknown): Promise<void> {
    const parsed = HostToMainControlSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (this.#files.handlesHost(message)) {
      await this.#files.handleHost(message);
      return;
    }
    if (message.type === 'historyResult') {
      this.#pendingHistory.get(message.requestId)?.(message.result);
      return;
    }
    if (message.type === 'statsResult') {
      this.#pendingStats.get(message.requestId)?.(message.result);
      return;
    }
    if (message.type === 'keyGenerated') {
      this.#pendingKeyGen.get(message.requestId)?.(message.result);
      return;
    }
    if (message.type === 'keyInfo') {
      this.#pendingKeyInfo.get(message.requestId)?.(message.result);
      return;
    }
    const sender = this.#senders.get(message.sessionId);
    if (!sender || sender.isDestroyed()) return;
    // 닫는 중인 세션: 탭이 없는데 확인창이 뜨지 않게 바로 거부한다
    if (this.#closing.has(message.sessionId)) {
      if (message.type === 'hostKeyCheck') {
        this.#post({ type: 'hostKeyDecision', requestId: message.requestId, accept: false });
        return;
      }
      if (message.type === 'kbdPrompt') {
        this.#post({ type: 'kbdAnswers', requestId: message.requestId, answers: [] });
        return;
      }
    }

    switch (message.type) {
      case 'state':
        void this.#options.logger?.info('세션 상태', {
          sessionId: message.sessionId,
          state: message.state,
          errorCode: message.errorCode,
        });
        this.#supervisor.onState(message.sessionId, message.state, message.errorCode);
        return;
      case 'hostKeyCheck': {
        const accept = await this.#decideHostKey(sender, message, message.sessionId);
        this.#post({ type: 'hostKeyDecision', requestId: message.requestId, accept });
        return;
      }
      case 'kbdPrompt': {
        this.#supervisor.markInteractive(message.sessionId); // 2FA 세션은 자동 재접속 안 함
        const answer = await this.#prompts.request(
          sender,
          {
            kind: 'keyboardInteractive',
            host: this.#hostOf(message.sessionId),
            name: message.name,
            instructions: message.instructions,
            prompts: message.prompts,
          },
          message.sessionId,
        );
        this.#post({
          type: 'kbdAnswers',
          requestId: message.requestId,
          answers: answer.kind === 'answers' ? answer.answers : [],
        });
        return;
      }
    }
  }

  #hostOf(sessionId: string): string {
    return this.#supervisor.paramsOf(sessionId)?.host ?? '';
  }

  /** SEC-3: trusted만 바로 통과. unknown은 사용자 확인, mismatch·revoked는 차단. */
  async #decideHostKey(
    sender: WebContents,
    message: Extract<HostToMainControl, { type: 'hostKeyCheck' }>,
    sessionId: string,
  ): Promise<boolean> {
    const knownHosts = this.#options.knownHosts;
    const presented = { keyType: message.keyType, key: message.key };
    const result = await knownHosts.evaluate(message.host, message.port, presented);
    if (result.verdict === 'trusted') return true;
    if (result.verdict === 'revoked') return false;

    const answer = await this.#prompts.request(
      sender,
      {
        kind: 'hostKey',
        verdict: result.verdict,
        host: message.host,
        port: message.port,
        keyType: message.keyType,
        fingerprint: message.fingerprint,
        ...(result.verdict === 'mismatch'
          ? { knownFingerprints: result.known.map((k) => fingerprintOf(k.key)) }
          : {}),
      },
      sessionId,
    );
    if (result.verdict === 'mismatch' || answer.kind !== 'hostKey') return false;
    if (answer.decision === 'accept-save') {
      await knownHosts.trust(message.host, message.port, presented);
    }
    // 수락 값만 나열한다(새 결정 값이 생겨도 수락으로 새지 않게)
    return answer.decision === 'accept-once' || answer.decision === 'accept-save';
  }

  #emitState(sessionId: string, state: SessionState, extra?: EmitExtra): void {
    const sender = this.#senders.get(sessionId);
    if (!sender || sender.isDestroyed()) return;
    this.#send(sender, {
      type: 'session.state',
      sessionId,
      state,
      ...(extra?.errorCode ? { errorCode: extra.errorCode as SshErrorCode } : {}),
      ...(extra?.reconnect ? { reconnect: extra.reconnect } : {}),
    });
    // 끝난 세션도 수동 재접속을 위해 기록이 남아 있으면 sender를 유지한다.
    if (!this.#supervisor.has(sessionId)) this.#forgetSession(sessionId);
  }

  #forgetSession(sessionId: string): void {
    this.#senders.delete(sessionId);
    this.#closing.delete(sessionId);
    this.#reauth.delete(sessionId);
  }

  #track(sender: WebContents): void {
    if (this.#windows.has(sender)) return;
    this.#windows.add(sender);
    sender.once('destroyed', () => {
      this.#windows.delete(sender);
      this.#dropped.forget(sender);
    });
  }

  #broadcast(event: MainToRendererEvent): void {
    for (const sender of this.#windows) this.#send(sender, event);
  }

  #send(sender: WebContents, event: MainToRendererEvent): void {
    if (!sender.isDestroyed()) sender.send(IPC.event, MainToRendererEventSchema.parse(event));
  }

  #post(message: MainToHostControl, ports?: Electron.MessagePortMain[]): void {
    this.#host.postMessage(MainToHostControlSchema.parse(message), ports);
  }
}

const HISTORY_TIMEOUT_MS = 30_000;
const KEY_INFO_TIMEOUT_MS = 15_000;
/** RSA 4096은 느린 PC에서 몇 초 걸린다 */
const KEY_GEN_TIMEOUT_MS = 60_000;

type KeyGenResult = { ok: true; privateKey: string } | { ok: false };
/** session host의 회차 상한(5초)보다 조금 길게 */
const STATS_TIMEOUT_MS = 8_000;

/** session host에 요청하고 응답을 기다린다. 시간이 지나면 fallback으로 끝낸다(보안 리뷰 #4). */
function awaitReply<T>(
  pending: Map<string, (value: T) => void>,
  send: (requestId: string) => void,
  fallback: T,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => settle(fallback), timeoutMs);
    const settle = (value: T) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(value);
    };
    pending.set(requestId, settle);
    send(requestId);
  });
}

type DialogProperty = 'openFile' | 'openDirectory' | 'createDirectory' | 'multiSelections';

/** 요청한 창에 붙는 파일 선택 창(F4.2 다운로드 폴더·업로드 파일) */
function openDialog(
  sender: WebContents,
  properties: DialogProperty[],
): Promise<Electron.OpenDialogReturnValue> {
  const win = BrowserWindow.fromWebContents(sender);
  return win ? dialog.showOpenDialog(win, { properties }) : dialog.showOpenDialog({ properties });
}

/**
 * 개인키 파일 읽기(F7.1). 네트워크 경로는 읽지 않는다: 동기화로 받은 경로가 \\host\share면
 * 읽는 순간 Windows 자격 증명(NTLM)이 그 호스트로 나간다(보안 리뷰 S-2 L4).
 */
function readKeyFile(path: string): Promise<Uint8Array> {
  if (isWindowsNetworkPath(path)) {
    return Promise.reject(Object.assign(new Error('network path'), { code: 'ENOENT' }));
  }
  return readLimitedFile(path, MAX_KEY_FILE_BYTES);
}
