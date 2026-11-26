import { z } from 'zod';

/** 서버·그룹 아이콘(F1.11). custom은 M1.5. */
export const IconRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), name: z.string().min(1), color: z.string().optional() }),
  z.object({ kind: z.literal('custom'), assetId: z.string().min(1) }),
]);
export type IconRef = z.infer<typeof IconRefSchema>;

export const FontSettingSchema = z.object({
  family: z.string().min(1),
  size: z.number().int().min(8).max(32),
  cursor: z.enum(['block', 'underline', 'bar']),
});

/** 제어 문자(줄바꿈·ESC 등)가 없는 한 줄 */
function isSingleLine(text: string): boolean {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * 연결 직후 명령(F6.11). 셸에 입력 + Enter 한 번만 보내므로 한 줄로 제한한다
 * (줄바꿈·제어 문자로 여러 명령이 실행되지 않게).
 */
export const StartupCommandSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine(isSingleLine, { message: 'single-line' })
  .refine((text) => text.trim().length > 0, { message: 'blank' });

/** 그룹이 하위로 물려주고 프로필이 재정의하는 값(D13). */
export const HostDefaultsSchema = z.object({
  icon: IconRefSchema.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityId: z.string().optional(),
  username: z.string().optional(),
  keepaliveSec: z.number().int().min(0).max(3600).optional(),
  tabColor: z.string().optional(),
  colorScheme: z.string().optional(),
  startupCommand: z.string().optional(),
  font: FontSettingSchema.optional(),
  /** 서버 상태 줄(F3.18). 없으면 태그로 정한다(ST10) */
  serverStats: z.boolean().optional(),
});
export type HostDefaults = z.infer<typeof HostDefaultsSchema>;

export const GroupSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  name: z.string().min(1),
  order: z.number().int(),
  defaults: HostDefaultsSchema,
});
export type Group = z.infer<typeof GroupSchema>;

export const IdentitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  username: z.string().min(1),
  credentialId: z.string().nullable(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const ProfileSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().nullable(),
  name: z.string().min(1),
  host: z.string().min(1),
  overrides: HostDefaultsSchema,
  tags: z.array(z.string()),
  updatedAt: z.number(),
  /** 최근 접속(F1.2). 선택 필드라 스키마 버전을 올리지 않는다. */
  lastConnectedAt: z.number().optional(),
  pinned: z.boolean().optional(),
  /** 같은 부모 아래 그룹·서버가 함께 쓰는 순서(F1.2a, DND1). 선택 필드라 버전 유지(DND2) */
  order: z.number().int().optional(),
  /** 가져오기 때 보존한 미지원 지시어(F1.4). 실행 항목은 승인 전 비활성(SEC-12). */
  unsupported: z.record(z.string(), z.string()).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** 개인키 메타데이터(F7). 비밀 본문은 vault에만 있고 여기에는 참조만 둔다(SEC-1). */
export const SshKeySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('path'), path: z.string().min(1) }),
    z.object({ kind: z.literal('vault'), secretRef: z.string().min(1) }),
  ]),
  keyType: z.enum(['ed25519', 'ecdsa', 'rsa']),
  bits: z.number().int().optional(),
  publicKey: z.string(),
  fingerprintSha256: z.string(),
  encrypted: z.boolean(),
  createdAt: z.number(),
});
export type SshKey = z.infer<typeof SshKeySchema>;

export const CredentialSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('password'), secretRef: z.string().min(1) }),
  z.object({
    id: z.string().min(1),
    type: z.literal('privateKey'),
    keyId: z.string().min(1),
    passphraseRef: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('agent'),
    agent: z.enum(['openssh', 'pageant']),
  }),
]);
export type Credential = z.infer<typeof CredentialSchema>;

export const PROFILE_STORE_VERSION = 1;

export const ProfileStoreSchema = z.object({
  schemaVersion: z.literal(PROFILE_STORE_VERSION),
  groups: z.array(GroupSchema),
  identities: z.array(IdentitySchema),
  profiles: z.array(ProfileSchema),
  keys: z.array(SshKeySchema),
  credentials: z.array(CredentialSchema),
});
export type ProfileStore = z.infer<typeof ProfileStoreSchema>;

export function emptyProfileStore(): ProfileStore {
  return {
    schemaVersion: PROFILE_STORE_VERSION,
    groups: [],
    identities: [],
    profiles: [],
    keys: [],
    credentials: [],
  };
}
