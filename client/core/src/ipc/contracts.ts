import { z } from 'zod';
import {
  GroupSchema,
  IdentitySchema,
  ProfileSchema,
  SshKeySchema,
  type ProfileStore,
  HostDefaultsSchema,
  StartupCommandSchema,
} from '../domain/model';
import { AppSettingsPatchSchema, AppSettingsSchema } from '../domain/appSettings';

// 프로세스 경계 메시지 계약(AGENTS.md §3). 모든 경계는 이 스키마로 런타임 검증한다.
//   renderer → main      : RendererToMainRequestSchema (invoke)
//   main → renderer      : MainToRendererEventSchema
//   renderer ↔ host port : RendererToHostFrameSchema / HostToRendererFrameSchema

const SessionId = z.string().min(1).max(64);
const Bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'Uint8Array가 아닙니다');
const Host = z.string().min(1).max(255);
const Port = z.number().int().min(1).max(65535);
/** 호스트 키 종류(ssh-ed25519 등). 인증서 형식(…-cert-v01@openssh.com)도 64자 안에 든다 */
const KeyType = z.string().min(1).max(64);
/** known_hosts에 쓰거나 연결 설정에 넘길 수 있는 키 종류 형식(SEC-3). 공백·대문자·제어문자 없음 */
export const KNOWN_HOST_KEY_TYPE = /^[a-z0-9@.-]{1,64}$/;
/** 경계를 넘는 호스트 키(base64)와 지문의 길이 상한. session host는 이보다 긴 키를 묻지 않고 거부한다 */
export const HOST_KEY_MAX_LENGTH = 16 * 1024;
export const FINGERPRINT_MAX_LENGTH = 128;
const Fingerprint = z.string().min(1).max(FINGERPRINT_MAX_LENGTH);
/** keyboard-interactive 문자열 상한. session host가 넘기기 전에 이 길이로 자른다 */
export const KBD_NAME_MAX = 256;
export const KBD_INSTRUCTIONS_MAX = 4096;
export const KBD_PROMPT_MAX = 1024;
const KbdPromptsSchema = z
  .array(z.object({ prompt: z.string().max(KBD_PROMPT_MAX), echo: z.boolean() }))
  .max(16);

export const SessionStateSchema = z.enum([
  'connecting',
  'authenticating',
  'ready',
  'reconnecting',
  'closed',
  'failed',
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SshErrorCodeSchema = z.enum([
  'host-key-rejected',
  'auth-failed',
  'bad-passphrase',
  'agent-unavailable',
  'dns',
  'refused',
  'timeout',
  'closed',
  'unknown',
]);

/** 사용자 응답. 비밀(비밀번호·passphrase)은 renderer → main 방향으로만 흐른다(SEC-1). */
export const PromptResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hostKey'),
    decision: z.enum(['reject', 'accept-once', 'accept-save']),
  }),
  z.object({ kind: z.literal('secret'), secret: z.string().max(4096) }),
  z.object({ kind: z.literal('answers'), answers: z.array(z.string().max(4096)).max(16) }),
  z.object({
    kind: z.literal('conflict'),
    decision: z.enum(['overwrite', 'skip', 'rename']),
    applyAll: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('cancel') }),
]);
export type PromptResponse = z.infer<typeof PromptResponseSchema>;

const Id = z.string().min(1).max(64);
const RemotePath = z.string().min(1).max(4096);
const LocalPath = z.string().min(1).max(4096);

/** 원격 파일 작업(F4.1, F4.2, F4.5) */
export const FilesOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list'), path: RemotePath }),
  z.object({ kind: z.literal('mkdir'), path: RemotePath }),
  z.object({ kind: z.literal('rename'), from: RemotePath, to: RemotePath }),
  z.object({ kind: z.literal('remove'), path: RemotePath }),
  z.object({
    kind: z.literal('chmod'),
    path: RemotePath,
    mode: z.number().int().min(0).max(0o7777),
  }),
  z.object({ kind: z.literal('shellStatus') }),
  z.object({ kind: z.literal('shellInstall') }),
  z.object({ kind: z.literal('shellUninstall') }),
]);
export type FilesOp = z.infer<typeof FilesOpSchema>;

/** 알려진 호스트 한 항목(F2.4b). 호스트 공개키는 비밀이 아니다 */
export interface KnownHostView {
  source: 'app' | 'user';
  line: number;
  /** 해시된 항목은 이름을 알 수 없다 */
  hosts: string | null;
  keyType: string;
  key: string;
  fingerprint: string;
  marker: 'cert-authority' | 'revoked' | null;
}

/** main → host 전용 파일 작업. 공개키 등록(F7.8)은 main이 저장소에서 꺼낸 키로만 만든다 */
export const HostFilesOpSchema = z.discriminatedUnion('kind', [
  ...FilesOpSchema.options,
  z.object({
    kind: z.literal('installKey'),
    publicKey: z
      .string()
      .min(1)
      .max(16 * 1024),
  }),
]);
export type HostFilesOp = z.infer<typeof HostFilesOpSchema>;

/** 원격 목록 한 항목(F4.1). 이름은 원격이 정하므로 신뢰하지 않는다(SEC-5): 형식·길이만 통과시킨다 */
const RemoteEntrySchema = z.strictObject({
  name: z.string().min(1).max(1024),
  type: z.enum(['file', 'dir', 'link', 'other']),
  size: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
  mtimeMs: z.number(),
  mode: z.number().int().min(0).max(0o7777),
});
export const FilesListResultSchema = z.strictObject({
  path: RemotePath,
  entries: z.array(RemoteEntrySchema).max(100_000),
});
export const ShellIntegrationStatusSchema = z.strictObject({
  installed: z.boolean(),
  rcFiles: z.array(z.string().min(1).max(64)).max(16),
  loginCovered: z.boolean().nullable(),
});
export const InstallKeyResultSchema = z.strictObject({ added: z.boolean() });

const FILES_OP_RESULT_SCHEMAS: Record<HostFilesOp['kind'], z.ZodType> = {
  list: FilesListResultSchema,
  mkdir: z.null(),
  rename: z.null(),
  remove: z.null(),
  chmod: z.null(),
  shellStatus: ShellIntegrationStatusSchema,
  shellInstall: ShellIntegrationStatusSchema,
  shellUninstall: ShellIntegrationStatusSchema,
  installKey: InstallKeyResultSchema,
};

/** session host가 돌려준 파일 작업 결과의 스키마. main이 renderer로 넘기기 전에 검증한다(AGENTS §3) */
export function filesOpResultSchema(kind: HostFilesOp['kind']): z.ZodType {
  return FILES_OP_RESULT_SCHEMAS[kind];
}

export const TransferJobSchema = z.object({
  id: Id,
  sessionId: z.string().min(1).max(64),
  direction: z.enum(['upload', 'download']),
  sourcePath: z.string().min(1).max(4096),
  targetDir: z.string().min(1).max(4096),
  name: z.string().min(1).max(1024),
  batchId: Id.optional(),
  /** 로컬 편집 업로드: 확인 없이 바꿔 넣기(TR3) */
  overwrite: z.boolean().optional(),
});

export const TransferStatusSchema = z.object({
  id: Id,
  sessionId: z.string().min(1).max(64),
  direction: z.enum(['upload', 'download']),
  name: z.string().max(1024),
  state: z.enum(['queued', 'running', 'done', 'failed', 'cancelled', 'skipped']),
  bytes: z.number().min(0),
  total: z.number().min(0),
  error: z.string().max(64).optional(),
  /** 폴더 작업(TR1): bytes·total = 끝난 파일 수·찾은 파일 수 */
  folder: z.boolean().optional(),
  /** 폴더를 펼쳐 생긴 작업(화면에는 보내지 않는다) */
  parentId: z.string().max(64).optional(),
});
const PassphrasePolicySchema = z.enum(['ask', 'session', 'vault']);
const GeneratedKeyTypeSchema = z.enum(['ed25519', 'rsa']);
export type GeneratedKeyType = z.infer<typeof GeneratedKeyTypeSchema>;
export type PassphrasePolicy = z.infer<typeof PassphrasePolicySchema>;

/** Identity 저장 요청. 비밀번호는 renderer → main 한 방향으로만 온다(SEC-1). */
export const IdentityAuthInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('password'), password: z.string().max(4096).optional() }),
  z.object({ kind: z.literal('key'), keyId: Id }),
  z.object({ kind: z.literal('agent') }),
]);

/**
 * renderer가 저장하는 기본값·재정의. 저장 파일 스키마보다 엄격하게, 연결 직후 명령은 한 줄만 받는다
 * (잘못된 값이 저장된 것처럼 보이고 연결 때 조용히 빠지지 않게, 보안 리뷰 L1).
 */
const SavedDefaultsSchema = HostDefaultsSchema.extend({
  startupCommand: StartupCommandSchema.optional(),
});

export const RendererToMainRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('profiles.get') }),
  z.object({
    type: z.literal('profiles.saveProfile'),
    profile: ProfileSchema.extend({ overrides: SavedDefaultsSchema }),
  }),
  z.object({ type: z.literal('profiles.deleteProfile'), profileId: Id }),
  z.object({
    type: z.literal('profiles.saveGroup'),
    group: GroupSchema.extend({ defaults: SavedDefaultsSchema }),
  }),
  z.object({ type: z.literal('profiles.deleteGroup'), groupId: Id }),
  /** 서버 트리 끌어 놓기(F1.2a). 순서 재계산·저장은 main이 한 번에 한다(DND3). */
  z.object({
    type: z.literal('profiles.move'),
    item: z.object({ kind: z.enum(['group', 'profile']), id: Id }),
    parentId: Id.nullable(),
    index: z.number().int().min(0).max(100_000),
  }),
  z.object({
    type: z.literal('profiles.saveIdentity'),
    identity: z.object({
      id: Id.optional(),
      label: z.string().min(1),
      username: z.string().min(1),
    }),
    auth: IdentityAuthInputSchema,
  }),
  z.object({
    type: z.literal('keys.addFromPath'),
    label: z.string().min(1),
    path: z.string().min(1).max(1024),
    passphrase: z.string().max(4096).optional(),
    passphrasePolicy: PassphrasePolicySchema,
  }),
  z.object({
    type: z.literal('keys.importText'),
    label: z.string().min(1),
    text: z
      .string()
      .min(1)
      .max(64 * 1024),
    passphrase: z.string().max(4096).optional(),
    passphrasePolicy: PassphrasePolicySchema,
  }),
  z.object({ type: z.literal('keys.delete'), keyId: Id }),
  // F7.7: 개인키는 main이 보관소에 넣는다. renderer는 목록의 공개키만 받는다(SEC-1)
  z.object({
    type: z.literal('keys.generate'),
    label: z.string().min(1).max(200),
    keyType: GeneratedKeyTypeSchema,
    passphrase: z.string().max(4096).optional(),
    passphrasePolicy: PassphrasePolicySchema,
  }),
  // F2.4b(TR6): 알려진 호스트 목록·삭제. 삭제는 btterm 파일 항목만(main이 확인)
  z.object({ type: z.literal('knownHosts.list') }),
  z.object({
    type: z.literal('knownHosts.remove'),
    line: z.number().int().min(1).max(1_000_000),
    keyType: z.string().min(1).max(64),
    key: z
      .string()
      .min(1)
      .max(16 * 1024),
  }),
  // F7.8: 열린 세션의 서버 ~/.ssh/authorized_keys에 등록한다. 공개키는 main이 저장소에서 꺼낸다
  z.object({ type: z.literal('keys.install'), keyId: Id, sessionId: SessionId }),
  // 보관소 키를 사용자가 고른 파일로 내보낸다(저장 대화상자는 main)
  z.object({ type: z.literal('keys.export'), keyId: Id }),
  z.object({ type: z.literal('import.sshConfig') }),
  z.object({ type: z.literal('session.openProfile'), profileId: Id }),
  z.object({ type: z.literal('session.reconnect'), sessionId: SessionId }),
  z.object({
    type: z.literal('session.openQuick'),
    host: Host,
    port: Port,
    username: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal('session.close'), sessionId: SessionId }),
  z.object({
    type: z.literal('clipboard.writeText'),
    text: z.string().max(1024 * 1024),
  }),
  z.object({ type: z.literal('clipboard.readText') }),
  z.object({ type: z.literal('link.open'), url: z.string().min(1).max(2048) }),
  z.object({ type: z.literal('settings.get') }),
  z.object({ type: z.literal('settings.update'), patch: AppSettingsPatchSchema }),
  z.object({ type: z.literal('history.load'), sessionId: SessionId }),
  z.object({ type: z.literal('stats.read'), sessionId: SessionId }),
  z.object({ type: z.literal('files.op'), sessionId: SessionId, op: FilesOpSchema }),
  z.object({
    type: z.literal('files.download'),
    sessionId: SessionId,
    remotePaths: z.array(RemotePath).min(1).max(1000),
  }),
  z.object({
    type: z.literal('files.upload'),
    sessionId: SessionId,
    remoteDir: RemotePath,
    /** 탐색기에서 끌어 놓은 파일. 없으면 main이 파일 선택 창을 연다 */
    localPaths: z.array(LocalPath).min(1).max(1000).optional(),
    /** 선택 창 종류: 파일(기본) 또는 폴더(F4.7) */
    pick: z.enum(['files', 'folder']).optional(),
  }),
  z.object({ type: z.literal('transfer.cancel'), transferId: Id }),
  /** 원격 파일을 로컬 기본 앱으로 연다(F4.8, TR3) */
  z.object({ type: z.literal('files.editLocal'), sessionId: SessionId, remotePath: RemotePath }),
  /** 로컬에서 고친 파일을 원래 자리에 올린다(사용자가 누를 때만) */
  z.object({ type: z.literal('files.editUpload'), editId: Id }),
  /** 실패한 전송을 부분 파일에서 잇는다(TR2) */
  z.object({ type: z.literal('transfer.retry'), transferId: Id }),
  /** 실패한 전송을 목록에서 정리하고 부분 파일을 지운다(TR2) */
  z.object({ type: z.literal('transfer.discard'), transferId: Id }),
  z.object({
    type: z.literal('prompt.respond'),
    promptId: z.string().min(1).max(64),
    response: PromptResponseSchema,
  }),
]);
export type RendererToMainRequest = z.infer<typeof RendererToMainRequestSchema>;

export const PromptSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hostKey'),
    verdict: z.enum(['unknown', 'mismatch']),
    host: Host,
    port: Port,
    keyType: KeyType,
    fingerprint: Fingerprint,
    knownFingerprints: z.array(Fingerprint).max(32).optional(),
    /** mismatch 사유(SEC-3). other-type-known: 다른 종류의 키만 알려진 호스트가 이 종류를 내밀었다 */
    mismatchReason: z.enum(['key-changed', 'other-type-known']).optional(),
    /** 이 호스트에 저장된 키 종류(other-type-known일 때 보여 준다) */
    knownKeyTypes: z.array(KeyType).max(32).optional(),
  }),
  z.object({ kind: z.literal('password'), host: Host, username: z.string() }),
  z.object({ kind: z.literal('passphrase'), keyLabel: z.string() }),
  z.object({
    kind: z.literal('fileConflict'),
    name: z.string().max(1024),
    direction: z.enum(['upload', 'download']),
  }),
  z.object({
    kind: z.literal('keyboardInteractive'),
    host: Host,
    name: z.string().max(KBD_NAME_MAX),
    instructions: z.string().max(KBD_INSTRUCTIONS_MAX),
    prompts: KbdPromptsSchema,
  }),
]);
export type Prompt = z.infer<typeof PromptSchema>;

/** renderer용 프로필 view. vault 참조(secretRef·passphraseRef)는 빼고 저장 여부만 알린다(SEC-1). */
export const ProfilesViewSchema = z.object({
  groups: z.array(GroupSchema),
  identities: z.array(IdentitySchema),
  profiles: z.array(ProfileSchema),
  keys: z.array(
    SshKeySchema.omit({ source: true }).extend({
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('path'), path: z.string() }),
        z.object({ kind: z.literal('vault') }),
      ]),
    }),
  ),
  credentials: z.array(
    z.object({
      id: Id,
      type: z.enum(['password', 'privateKey', 'agent']),
      keyId: Id.optional(),
      hasStoredValue: z.boolean(),
    }),
  ),
});
export type ProfilesView = z.infer<typeof ProfilesViewSchema>;

export function toProfilesView(store: ProfileStore): ProfilesView {
  return {
    groups: store.groups,
    identities: store.identities,
    profiles: store.profiles,
    keys: store.keys.map((k) => ({
      ...k,
      source: k.source.kind === 'path' ? k.source : { kind: 'vault' as const },
    })),
    credentials: store.credentials.map((c) => {
      if (c.type === 'password') return { id: c.id, type: c.type, hasStoredValue: true };
      if (c.type === 'privateKey') {
        return {
          id: c.id,
          type: c.type,
          keyId: c.keyId,
          hasStoredValue: c.passphraseRef !== undefined,
        };
      }
      return { id: c.id, type: c.type, hasStoredValue: false };
    }),
  };
}

/** 원격 셸 기록(F3.17a). 항목은 session host에서 정리·마스킹한 뒤 온다. */
export const HistoryResultSchema = z.object({
  status: z.enum(['ok', 'missing', 'denied', 'unavailable']),
  entries: z
    .array(z.object({ command: z.string().max(8192), timestamp: z.number().nullable() }))
    .max(5000),
});
export type HistoryResult = z.infer<typeof HistoryResultSchema>;

const ByteCount = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
const UsedTotal = z.object({ usedBytes: ByteCount, totalBytes: ByteCount }).nullable();

/** 서버 상태 줄(F3.18). session host가 원격 출력을 해석해 숫자와 정리된 짧은 문자열만 보낸다(SEC-5). */
export const ServerStatsSchema = z.object({
  os: z.string().max(128).nullable(),
  user: z.string().max(64).nullable(),
  cpuPercent: z.number().min(0).max(100).nullable(),
  mem: UsedTotal,
  net: z.object({ rxPerSec: ByteCount, txPerSec: ByteCount }).nullable(),
  uptimeSec: ByteCount.nullable(),
  disk: UsedTotal,
});

export const StatsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), stats: ServerStatsSchema }),
  z.object({ status: z.literal('unavailable') }),
]);
export type StatsResult = z.infer<typeof StatsResultSchema>;

export const MainToRendererEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.state'),
    sessionId: SessionId,
    state: SessionStateSchema,
    errorCode: SshErrorCodeSchema.optional(),
    reconnect: z
      .object({ attempt: z.number().int().min(1), nextDelayMs: z.number().int().min(0).nullable() })
      .optional(),
  }),
  z.object({
    type: z.literal('prompt.request'),
    promptId: z.string(),
    /** 세션에 딸린 확인창(호스트 키·2단계 인증·재접속 비밀번호). 세션이 끝나면 main이 취소한다(DF1) */
    sessionId: z.string().max(64).optional(),
    prompt: PromptSchema,
  }),
  z.object({ type: z.literal('prompt.cancelled'), promptId: z.string() }),
  z.object({ type: z.literal('profiles.changed'), view: ProfilesViewSchema }),
  z.object({ type: z.literal('transfer.status'), status: TransferStatusSchema }),
  /** 창이 전체 화면에 들어가거나 나왔다. macOS 신호등 여백을 정한다(DESIGN §4.2) */
  z.object({ type: z.literal('window.fullScreen'), fullScreen: z.boolean() }),
  /** 로컬에서 편집 중인 파일이 저장됐다(TR3) */
  z.object({
    type: z.literal('files.editChanged'),
    editId: Id,
    sessionId: SessionId,
    name: z.string().max(1024),
  }),
]);
export type MainToRendererEvent = z.infer<typeof MainToRendererEventSchema>;

export const RendererToHostFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('input'), data: z.string().max(64 * 1024) }),
  z.object({
    t: z.literal('resize'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(500),
  }),
  z.object({ t: z.literal('ack'), bytes: z.number().int().min(0) }),
]);
export type RendererToHostFrame = z.infer<typeof RendererToHostFrameSchema>;

export const HostToRendererFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('data'), data: Bytes }),
  z.object({ t: z.literal('exit') }),
]);
export type HostToRendererFrame = z.infer<typeof HostToRendererFrameSchema>;

const PtySizeSchema = z.object({
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(500),
});

/** main → session host(parentPort). 비밀은 이 방향으로만 흐르고 renderer에는 가지 않는다(SEC-1). */
export const MainToHostControlSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('open'),
    sessionId: SessionId,
    /** 셸이 준비되면 한 번 입력할 명령(F6.11) */
    startupCommand: StartupCommandSchema.optional(),
    host: Host,
    port: Port,
    username: z.string().min(1).max(64),
    keepaliveSec: z.number().int().min(0).max(3600),
    /** 이 호스트에 이미 저장된 키 종류. 서버가 이 종류를 먼저 고르게 한다(SEC-3) */
    knownHostKeyTypes: z.array(z.string().regex(KNOWN_HOST_KEY_TYPE)).max(16).optional(),
    auth: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('password'), password: z.string() }),
        z.object({
          kind: z.literal('privateKey'),
          privateKey: Bytes,
          passphrase: z.string().optional(),
        }),
        z.object({ kind: z.literal('agent'), agentPath: z.string() }),
      ]),
    ),
    size: PtySizeSchema,
  }),
  z.object({ type: z.literal('close'), sessionId: SessionId }),
  z.object({ type: z.literal('hostKeyDecision'), requestId: z.string(), accept: z.boolean() }),
  z.object({ type: z.literal('probe'), sessionId: SessionId }),
  z.object({
    type: z.literal('inspectKey'),
    requestId: z.string(),
    privateKey: Bytes,
    passphrase: z.string().optional(),
  }),
  z.object({
    type: z.literal('generateKey'),
    requestId: z.string().max(64),
    keyType: GeneratedKeyTypeSchema,
    passphrase: z.string().max(4096).optional(),
    comment: z.string().max(256),
  }),
  z.object({ type: z.literal('readHistory'), requestId: z.string(), sessionId: SessionId }),
  z.object({ type: z.literal('readStats'), requestId: z.string(), sessionId: SessionId }),
  z.object({
    type: z.literal('files'),
    requestId: z.string(),
    sessionId: SessionId,
    op: HostFilesOpSchema,
  }),
  z.object({ type: z.literal('transfer'), job: TransferJobSchema }),
  z.object({ type: z.literal('transferCancel'), transferId: Id }),
  z.object({ type: z.literal('transferRetry'), transferId: Id }),
  z.object({ type: z.literal('transferDiscard'), transferId: Id }),
  z.object({
    type: z.literal('conflictAnswer'),
    requestId: z.string(),
    decision: z.enum(['overwrite', 'skip', 'rename']),
    applyAll: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('kbdAnswers'),
    requestId: z.string(),
    answers: z.array(z.string()).max(16),
  }),
]);
export type MainToHostControl = z.infer<typeof MainToHostControlSchema>;

/** session host → main(parentPort). */
export const HostToMainControlSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    sessionId: SessionId,
    state: SessionStateSchema,
    errorCode: SshErrorCodeSchema.optional(),
  }),
  z.object({
    type: z.literal('hostKeyCheck'),
    requestId: z.string(),
    sessionId: SessionId,
    host: Host,
    port: Port,
    keyType: KeyType,
    key: z.string().min(1).max(HOST_KEY_MAX_LENGTH),
    fingerprint: Fingerprint,
  }),
  z.object({
    type: z.literal('keyGenerated'),
    requestId: z.string().max(64),
    result: z.discriminatedUnion('ok', [
      z.object({
        ok: z.literal(true),
        privateKey: z
          .string()
          .min(1)
          .max(64 * 1024),
      }),
      z.object({ ok: z.literal(false) }),
    ]),
  }),
  z.object({
    type: z.literal('keyInfo'),
    requestId: z.string(),
    result: z.discriminatedUnion('ok', [
      z.object({
        ok: z.literal(true),
        keyType: KeyType,
        publicKey: z
          .string()
          .min(1)
          .max(16 * 1024),
        fingerprint: Fingerprint,
        encrypted: z.boolean(),
      }),
      z.object({
        ok: z.literal(false),
        reason: z.enum(['needs-passphrase', 'bad-passphrase', 'invalid']),
      }),
    ]),
  }),
  z.object({
    type: z.literal('kbdPrompt'),
    requestId: z.string(),
    sessionId: SessionId,
    name: z.string().max(KBD_NAME_MAX),
    instructions: z.string().max(KBD_INSTRUCTIONS_MAX),
    prompts: KbdPromptsSchema,
  }),
  z.object({
    type: z.literal('historyResult'),
    requestId: z.string(),
    result: HistoryResultSchema,
  }),
  z.object({
    type: z.literal('statsResult'),
    requestId: z.string(),
    result: StatsResultSchema,
  }),
  z.discriminatedUnion('ok', [
    z.object({
      type: z.literal('filesResult'),
      requestId: z.string(),
      ok: z.literal(true),
      /** 작업 종류별 형식은 main이 filesOpResultSchema로 검증한 뒤 renderer로 넘긴다 */
      result: z.unknown(),
    }),
    z.object({
      type: z.literal('filesResult'),
      requestId: z.string(),
      ok: z.literal(false),
      error: z.string().max(64),
    }),
  ]),
  z.object({ type: z.literal('transferStatus'), status: TransferStatusSchema }),
  z.object({
    type: z.literal('transferConflict'),
    requestId: z.string(),
    sessionId: SessionId,
    name: z.string().max(1024),
    direction: z.enum(['upload', 'download']),
  }),
]);
export type HostToMainControl = z.infer<typeof HostToMainControlSchema>;

/** renderer가 받는 스키마 목록. SEC-1 계약 테스트가 이 목록 전체를 검사한다. */
export const RENDERER_BOUND_SCHEMAS = {
  MainToRendererEventSchema,
  /** settings.get·settings.update 응답 */
  AppSettingsSchema,
  HostToRendererFrameSchema,
  HistoryResultSchema,
  StatsResultSchema,
  /** files.op 응답(작업 종류별 결과) */
  FilesListResultSchema,
  ShellIntegrationStatusSchema,
  InstallKeyResultSchema,
} as const;

// credentialId·credentials처럼 "참조"를 뜻하는 이름은 비밀이 아니다. 비밀 값 자체를 뜻하는 이름만 막는다.
// 복구 코드·계정 키처럼 보이는 이름도 막는다(보안 리뷰 M4).
const SECRET_FIELD = /pass(word|wd|phrase)?|private_?key|secret|token|^dek$|recovery|account_?key/i;

/** 스키마 안에서 비밀처럼 보이는 필드 경로를 모두 찾는다. */
export function findSecretFields(schema: z.ZodType): string[] {
  const found: string[] = [];
  walk(schema, '', found);
  return found;
}

interface SchemaDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  options?: z.ZodType[];
  innerType?: z.ZodType;
  element?: z.ZodType;
  valueType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
}

function walk(schema: z.ZodType, path: string, found: string[]): void {
  const def = (schema as unknown as { def: SchemaDef }).def;
  switch (def.type) {
    case 'object':
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        const childPath = path ? `${path}.${key}` : key;
        if (SECRET_FIELD.test(key)) found.push(childPath);
        walk(child, childPath, found);
      }
      return;
    case 'union':
      for (const option of def.options ?? []) walk(option, path, found);
      return;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
      if (def.innerType) walk(def.innerType, path, found);
      return;
    case 'pipe':
      if (def.in) walk(def.in, path, found);
      if (def.out) walk(def.out, path, found);
      return;
    case 'array':
      if (def.element) walk(def.element, `${path}[]`, found);
      return;
    case 'record':
      if (def.valueType) walk(def.valueType, `${path}{}`, found);
      return;
    default:
      return;
  }
}
