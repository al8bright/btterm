import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  filesOpResultSchema,
  findSecretFields,
  KBD_INSTRUCTIONS_MAX,
  KBD_NAME_MAX,
  KBD_PROMPT_MAX,
  HistoryResultSchema,
  HostToMainControlSchema,
  HostToRendererFrameSchema,
  MainToHostControlSchema,
  MainToRendererEventSchema,
  ProfilesViewSchema,
  PromptResponseSchema,
  PromptSchema,
  RENDERER_BOUND_SCHEMAS,
  toProfilesView,
  RendererToHostFrameSchema,
  RendererToMainRequestSchema,
  StatsResultSchema,
} from './contracts';
import { AppSettingsSchema, defaultAppSettings } from '../domain/appSettings';

describe('IPC 계약', () => {
  it('SEC-1 renderer로 가는 모든 스키마에 비밀 필드 이름이 없다', () => {
    for (const [name, schema] of Object.entries(RENDERER_BOUND_SCHEMAS)) {
      expect(findSecretFields(schema), name).toEqual([]);
    }
  });

  it('findSecretFields는 중첩된 비밀 필드를 찾아낸다(검사기 자체 검증)', () => {
    const found = findSecretFields(RendererToMainRequestSchema);
    expect(found.some((path) => path.endsWith('.secret'))).toBe(true);
  });

  it('findSecretFields는 catch·pipe·readonly로 감싼 필드 안도 본다(검사기 자체 검증)', () => {
    const inner = z.object({ token: z.string() });
    const schema = z.object({
      caught: inner.optional().catch(undefined),
      piped: z.unknown().pipe(z.object({ secret: z.string() })),
      frozen: inner.readonly(),
    });
    expect(findSecretFields(schema)).toEqual(['caught.token', 'piped.secret', 'frozen.token']);
  });

  it('SEC-1 설정(settings.get·update 응답)도 renderer로 가는 스키마로 검사한다', () => {
    expect(Object.values(RENDERER_BOUND_SCHEMAS)).toContain(AppSettingsSchema);
  });

  it('SEC-1 복구 코드·계정 키 같은 이름도 비밀로 본다', () => {
    const flag = StatsResultSchema.options[1].shape.status;
    const z = StatsResultSchema.options[1].extend({ recoveryCode: flag, accountKey: flag });
    expect(findSecretFields(z)).toEqual(['recoveryCode', 'accountKey']);
  });

  it('제거한 계정·동기화(F8)·자동 업데이트(F5.6) 메시지는 경계에서 거부한다', () => {
    for (const type of [
      'account.status',
      'account.login',
      'account.logout',
      'sync.now',
      'sync.confirmDeletions',
      'update.status',
      'update.install',
    ]) {
      expect(RendererToMainRequestSchema.safeParse({ type }).success, type).toBe(false);
    }
    expect(
      MainToRendererEventSchema.safeParse({ type: 'update.ready', version: '0.3.0' }).success,
    ).toBe(false);
    expect(MainToRendererEventSchema.safeParse({ type: 'account.changed', view: {} }).success).toBe(
      false,
    );
    expect(
      MainToRendererEventSchema.safeParse({
        type: 'settings.changed',
        settings: defaultAppSettings(),
      }).success,
    ).toBe(false);
  });

  it('renderer → session host 프레임: input, resize, ack만 허용한다', () => {
    expect(RendererToHostFrameSchema.safeParse({ t: 'input', data: 'ls\n' }).success).toBe(true);
    expect(RendererToHostFrameSchema.safeParse({ t: 'resize', cols: 120, rows: 40 }).success).toBe(
      true,
    );
    expect(RendererToHostFrameSchema.safeParse({ t: 'ack', bytes: 4096 }).success).toBe(true);
    expect(RendererToHostFrameSchema.safeParse({ t: 'exec', cmd: 'rm' }).success).toBe(false);
  });

  it('resize는 0 크기와 비정상 값을 거부한다(숨긴 탭의 0×0 전송 방지)', () => {
    expect(RendererToHostFrameSchema.safeParse({ t: 'resize', cols: 0, rows: 24 }).success).toBe(
      false,
    );
    expect(RendererToHostFrameSchema.safeParse({ t: 'resize', cols: 1e6, rows: 24 }).success).toBe(
      false,
    );
  });

  it('ack는 음수를 거부한다', () => {
    expect(RendererToHostFrameSchema.safeParse({ t: 'ack', bytes: -1 }).success).toBe(false);
  });

  it('session host → renderer 데이터 프레임은 바이트만 담는다', () => {
    expect(
      HostToRendererFrameSchema.safeParse({ t: 'data', data: new Uint8Array([104, 105]) }).success,
    ).toBe(true);
    expect(HostToRendererFrameSchema.safeParse({ t: 'data', data: 'hi' }).success).toBe(false);
  });

  it('호스트 키 확인 요청 이벤트를 검증한다', () => {
    const ok = MainToRendererEventSchema.safeParse({
      type: 'prompt.request',
      promptId: 'p1',
      prompt: {
        kind: 'hostKey',
        verdict: 'mismatch',
        host: 'db-01',
        port: 22,
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc',
        knownFingerprints: ['SHA256:old'],
      },
    });
    expect(ok.success).toBe(true);
  });

  it('SEC-3 AC10 호스트 키 차단 창은 사유(키 변경·다른 종류 알려짐)와 알려진 종류를 담는다', () => {
    const prompt = (extra: Record<string, unknown>) =>
      PromptSchema.safeParse({
        kind: 'hostKey',
        verdict: 'mismatch',
        host: 'db-01',
        port: 22,
        keyType: 'ssh-rsa',
        fingerprint: 'SHA256:abc',
        knownFingerprints: ['SHA256:old'],
        ...extra,
      }).success;
    expect(prompt({ mismatchReason: 'other-type-known', knownKeyTypes: ['ssh-ed25519'] })).toBe(
      true,
    );
    expect(prompt({ mismatchReason: 'key-changed' })).toBe(true);
    expect(prompt({ mismatchReason: 'whatever' })).toBe(false);
    expect(prompt({ keyType: 'x'.repeat(65) })).toBe(false);
    expect(prompt({ knownKeyTypes: ['x'.repeat(65)] })).toBe(false);
  });

  it('SEC-3 open 메시지는 알려진 호스트 키 종류를 형식·개수 제한해 담는다', () => {
    const open = (knownHostKeyTypes: unknown) =>
      MainToHostControlSchema.safeParse({
        type: 'open',
        sessionId: 's1',
        host: '127.0.0.1',
        port: 2222,
        username: 'btterm',
        keepaliveSec: 30,
        auth: [],
        size: { cols: 80, rows: 24 },
        knownHostKeyTypes,
      }).success;
    expect(open(['ssh-ed25519', 'ssh-ed25519-cert-v01@openssh.com'])).toBe(true);
    expect(open(undefined)).toBe(true);
    expect(open(['SSH-RSA'])).toBe(false);
    expect(open(['ssh-rsa x'])).toBe(false);
    expect(open(Array.from({ length: 17 }, (_, i) => `t${i}`))).toBe(false);
  });

  it('호스트 키 종류·keyboard-interactive 문자열에 길이 상한이 있다', () => {
    const toMain = (raw: unknown) => HostToMainControlSchema.safeParse(raw).success;
    const hostKey = {
      type: 'hostKeyCheck',
      requestId: 'r1',
      sessionId: 's1',
      host: 'h',
      port: 22,
      keyType: 'ssh-ed25519',
      key: 'AAAA',
      fingerprint: 'SHA256:x',
    };
    expect(toMain(hostKey)).toBe(true);
    expect(toMain({ ...hostKey, keyType: 'k'.repeat(65) })).toBe(false);
    const kbd = {
      type: 'kbdPrompt',
      requestId: 'r',
      sessionId: 's1',
      name: 'n',
      instructions: 'i',
      prompts: [{ prompt: 'Code: ', echo: false }],
    };
    expect(toMain(kbd)).toBe(true);
    expect(toMain({ ...kbd, name: 'n'.repeat(KBD_NAME_MAX + 1) })).toBe(false);
    expect(toMain({ ...kbd, instructions: 'i'.repeat(KBD_INSTRUCTIONS_MAX + 1) })).toBe(false);
    expect(
      toMain({ ...kbd, prompts: [{ prompt: 'p'.repeat(KBD_PROMPT_MAX + 1), echo: false }] }),
    ).toBe(false);
    const prompt = {
      kind: 'keyboardInteractive',
      host: 'h',
      name: 'n'.repeat(KBD_NAME_MAX + 1),
      instructions: '',
      prompts: [],
    };
    expect(PromptSchema.safeParse(prompt).success).toBe(false);
  });

  it('main → session host open 제어 메시지를 검증한다', () => {
    const ok = MainToHostControlSchema.safeParse({
      type: 'open',
      sessionId: 's1',
      host: '127.0.0.1',
      port: 2222,
      username: 'btterm',
      keepaliveSec: 30,
      auth: [{ kind: 'password', password: 'pw' }],
      size: { cols: 80, rows: 24 },
    });
    expect(ok.success).toBe(true);
  });

  it('F6.11 연결 직후 명령은 한 줄만(줄바꿈·제어 문자 거부)', () => {
    const open = (startupCommand: string) =>
      MainToHostControlSchema.safeParse({
        type: 'open',
        sessionId: 's1',
        host: '127.0.0.1',
        port: 2222,
        username: 'btterm',
        keepaliveSec: 30,
        auth: [{ kind: 'password', password: 'pw' }],
        size: { cols: 80, rows: 24 },
        startupCommand,
      }).success;
    expect(open('cd /srv/app && sudo -i')).toBe(true);
    expect(open('cd /app\nrm -rf /')).toBe(false);
    expect(open('ls\r')).toBe(false);
    expect(open('echo \u001b[2J')).toBe(false);
    expect(open('x'.repeat(1001))).toBe(false);
    expect(open('   ')).toBe(false);
  });

  it('F6.11 서버·그룹 저장 요청도 연결 직후 명령은 한 줄만 받는다(보안 리뷰 L1)', () => {
    const save = (startupCommand: string) =>
      RendererToMainRequestSchema.safeParse({
        type: 'profiles.saveProfile',
        profile: {
          id: 'p1',
          groupId: null,
          name: 'web',
          host: 'h',
          overrides: { startupCommand },
          tags: [],
          updatedAt: 0,
        },
      }).success;
    expect(save('cd /srv/app')).toBe(true);
    expect(save('cd /app\nrm -rf /')).toBe(false);
    const group = RendererToMainRequestSchema.safeParse({
      type: 'profiles.saveGroup',
      group: { id: 'g', parentId: null, name: 'G', order: 0, defaults: { startupCommand: 'a\rb' } },
    });
    expect(group.success).toBe(false);
  });

  it('session host → main 호스트 키 확인 요청과 상태 보고를 검증한다', () => {
    expect(
      HostToMainControlSchema.safeParse({
        type: 'hostKeyCheck',
        requestId: 'r1',
        sessionId: 's1',
        host: 'h',
        port: 22,
        keyType: 'ssh-ed25519',
        key: 'AAAA',
        fingerprint: 'SHA256:x',
      }).success,
    ).toBe(true);
    expect(
      HostToMainControlSchema.safeParse({
        type: 'state',
        sessionId: 's1',
        state: 'failed',
        errorCode: 'auth-failed',
      }).success,
    ).toBe(true);
  });

  it('SEC-1 renderer로 가는 프로필 view는 vault 참조를 담지 않는다', () => {
    const view = toProfilesView({
      schemaVersion: 1,
      groups: [],
      identities: [],
      profiles: [],
      keys: [],
      credentials: [
        { id: 'c1', type: 'password', secretRef: 'vault-ref-1' },
        { id: 'c2', type: 'privateKey', keyId: 'k1', passphraseRef: 'vault-ref-2' },
      ],
    });
    expect(JSON.stringify(view)).not.toContain('vault-ref');
    expect(view.credentials).toEqual([
      { id: 'c1', type: 'password', hasStoredValue: true },
      { id: 'c2', type: 'privateKey', keyId: 'k1', hasStoredValue: true },
    ]);
    expect(ProfilesViewSchema.safeParse(view).success).toBe(true);
  });

  it('프로필 요청 채널을 검증한다', () => {
    const ok = (raw: unknown) => RendererToMainRequestSchema.safeParse(raw).success;
    expect(ok({ type: 'profiles.get' })).toBe(true);
    expect(ok({ type: 'session.openProfile', profileId: 'p1' })).toBe(true);
    expect(ok({ type: 'session.reconnect', sessionId: 's1' })).toBe(true);
    expect(ok({ type: 'profiles.deleteProfile', profileId: 'p1' })).toBe(true);
    expect(
      ok({ type: 'keys.addFromPath', label: 'k', path: 'C:/k', passphrasePolicy: 'session' }),
    ).toBe(true);
    expect(
      ok({
        type: 'profiles.saveIdentity',
        identity: { label: 'ubuntu', username: 'ubuntu' },
        auth: { kind: 'password', password: 'pw' },
      }),
    ).toBe(true);
    expect(ok({ type: 'import.sshConfig' })).toBe(true);
  });

  it('AC35 트리 이동 요청은 대상 종류·부모·정수 위치만 받는다', () => {
    const ok = (raw: unknown) => RendererToMainRequestSchema.safeParse(raw).success;
    const move = { type: 'profiles.move', item: { kind: 'profile', id: 'p1' } };
    expect(ok({ ...move, parentId: 'g1', index: 0 })).toBe(true);
    expect(ok({ ...move, parentId: null, index: 3 })).toBe(true);
    expect(ok({ ...move, parentId: null, index: 1.5 })).toBe(false);
    expect(ok({ ...move, parentId: null, index: -1 })).toBe(false);
    expect(ok({ ...move, item: { kind: 'identity', id: 'i1' }, parentId: null, index: 0 })).toBe(
      false,
    );
  });

  it('keyboard-interactive 프롬프트와 응답을 검증한다', () => {
    expect(
      MainToRendererEventSchema.safeParse({
        type: 'prompt.request',
        promptId: 'p',
        prompt: {
          kind: 'keyboardInteractive',
          host: 'h',
          name: '',
          instructions: 'OTP',
          prompts: [{ prompt: 'Code: ', echo: false }],
        },
      }).success,
    ).toBe(true);
    expect(
      RendererToMainRequestSchema.safeParse({
        type: 'prompt.respond',
        promptId: 'p',
        response: { kind: 'answers', answers: ['123456'] },
      }).success,
    ).toBe(true);
  });

  it('재접속 상태를 session.state에 담는다', () => {
    expect(
      MainToRendererEventSchema.safeParse({
        type: 'session.state',
        sessionId: 's1',
        state: 'reconnecting',
        reconnect: { attempt: 2, nextDelayMs: 2000 },
      }).success,
    ).toBe(true);
  });

  it('main↔session host: probe, 키 검사, keyboard-interactive 중계 메시지를 검증한다', () => {
    const toHost = (raw: unknown) => MainToHostControlSchema.safeParse(raw).success;
    const toMain = (raw: unknown) => HostToMainControlSchema.safeParse(raw).success;
    expect(toHost({ type: 'probe', sessionId: 's1' })).toBe(true);
    expect(
      toHost({
        type: 'inspectKey',
        requestId: 'r',
        privateKey: new Uint8Array([1]),
        passphrase: 'p',
      }),
    ).toBe(true);
    expect(toHost({ type: 'kbdAnswers', requestId: 'r', answers: ['1'] })).toBe(true);
    expect(
      toMain({
        type: 'keyInfo',
        requestId: 'r',
        result: {
          ok: true,
          keyType: 'ssh-ed25519',
          publicKey: 'x',
          fingerprint: 'f',
          encrypted: false,
        },
      }),
    ).toBe(true);
    expect(
      toMain({ type: 'keyInfo', requestId: 'r', result: { ok: false, reason: 'invalid' } }),
    ).toBe(true);
    expect(
      toMain({
        type: 'kbdPrompt',
        requestId: 'r',
        sessionId: 's1',
        name: '',
        instructions: '',
        prompts: [{ prompt: 'Code: ', echo: false }],
      }),
    ).toBe(true);
  });

  it('클립보드·링크·설정·명령 기록 요청을 검증한다', () => {
    const ok = (value: unknown) => RendererToMainRequestSchema.safeParse(value).success;
    expect(ok({ type: 'clipboard.writeText', text: 'ls' })).toBe(true);
    expect(ok({ type: 'clipboard.writeText', text: 'x'.repeat(1024 * 1024 + 1) })).toBe(false);
    expect(ok({ type: 'clipboard.readText' })).toBe(true);
    expect(ok({ type: 'link.open', url: 'https://example.com' })).toBe(true);
    expect(ok({ type: 'settings.get' })).toBe(true);
    expect(ok({ type: 'settings.update', patch: { terminal: { fontSize: 15 } } })).toBe(true);
    expect(ok({ type: 'settings.update', patch: { terminal: { fontSize: 99 } } })).toBe(false);
    expect(ok({ type: 'history.load', sessionId: 's1' })).toBe(true);
  });

  it('명령 기록 결과는 상태와 항목만 담고 개수에 상한이 있다', () => {
    const entry = { command: 'ls', timestamp: null };
    expect(HistoryResultSchema.safeParse({ status: 'ok', entries: [entry] }).success).toBe(true);
    expect(HistoryResultSchema.safeParse({ status: 'missing', entries: [] }).success).toBe(true);
    expect(
      HistoryResultSchema.safeParse({ status: 'ok', entries: Array(5001).fill(entry) }).success,
    ).toBe(false);
    expect(
      MainToHostControlSchema.safeParse({ type: 'readHistory', requestId: 'r', sessionId: 's' })
        .success,
    ).toBe(true);
    expect(
      HostToMainControlSchema.safeParse({
        type: 'historyResult',
        requestId: 'r',
        result: { status: 'denied', entries: [] },
      }).success,
    ).toBe(true);
  });

  it('F3.18 서버 상태 요청·결과는 숫자와 길이 제한 문자열만 담는다', () => {
    expect(
      RendererToMainRequestSchema.safeParse({ type: 'stats.read', sessionId: 's1' }).success,
    ).toBe(true);
    const stats = {
      os: 'Ubuntu',
      user: 'root',
      cpuPercent: 12,
      mem: { usedBytes: 1, totalBytes: 2 },
      net: { rxPerSec: 1, txPerSec: 2 },
      uptimeSec: 10,
      disk: null,
    };
    expect(StatsResultSchema.safeParse({ status: 'ok', stats }).success).toBe(true);
    expect(StatsResultSchema.safeParse({ status: 'unavailable' }).success).toBe(true);
    expect(
      StatsResultSchema.safeParse({ status: 'ok', stats: { ...stats, os: 'x'.repeat(129) } })
        .success,
    ).toBe(false);
    expect(
      StatsResultSchema.safeParse({ status: 'ok', stats: { ...stats, cpuPercent: 101 } }).success,
    ).toBe(false);
    expect(RENDERER_BOUND_SCHEMAS).toHaveProperty('StatsResultSchema');
    expect(
      MainToHostControlSchema.safeParse({ type: 'readStats', requestId: 'r', sessionId: 's' })
        .success,
    ).toBe(true);
    expect(
      HostToMainControlSchema.safeParse({
        type: 'statsResult',
        requestId: 'r',
        result: { status: 'unavailable' },
      }).success,
    ).toBe(true);
  });

  it('F4 파일 작업·전송 요청을 검증한다', () => {
    const ok = (value: unknown) => RendererToMainRequestSchema.safeParse(value).success;
    expect(ok({ type: 'files.op', sessionId: 's', op: { kind: 'list', path: '/var/log' } })).toBe(
      true,
    );
    expect(
      ok({ type: 'files.op', sessionId: 's', op: { kind: 'chmod', path: '/a', mode: 0o644 } }),
    ).toBe(true);
    expect(
      ok({ type: 'files.op', sessionId: 's', op: { kind: 'chmod', path: '/a', mode: 0o70000 } }),
    ).toBe(false);
    expect(ok({ type: 'files.op', sessionId: 's', op: { kind: 'shellInstall' } })).toBe(true);
    expect(ok({ type: 'files.download', sessionId: 's', remotePaths: ['/a', '/b'] })).toBe(true);
    expect(
      ok({ type: 'files.upload', sessionId: 's', remoteDir: '/tmp', localPaths: ['C:/x'] }),
    ).toBe(true);
    expect(ok({ type: 'files.upload', sessionId: 's', remoteDir: '/tmp' })).toBe(true);
    expect(ok({ type: 'transfer.cancel', transferId: 't1' })).toBe(true);
  });

  it('F4.4 전송 상태 이벤트와 충돌 질의를 검증한다', () => {
    expect(
      MainToRendererEventSchema.safeParse({
        type: 'transfer.status',
        status: {
          id: 't1',
          sessionId: 's',
          direction: 'download',
          name: '보고서.txt',
          state: 'running',
          bytes: 10,
          total: 100,
        },
      }).success,
    ).toBe(true);
    expect(
      PromptSchema.safeParse({ kind: 'fileConflict', name: 'a.txt', direction: 'upload' }).success,
    ).toBe(true);
    expect(
      PromptResponseSchema.safeParse({ kind: 'conflict', decision: 'rename', applyAll: true })
        .success,
    ).toBe(true);
    expect(
      HostToMainControlSchema.safeParse({
        type: 'filesResult',
        requestId: 'r',
        ok: false,
        error: 'denied',
      }).success,
    ).toBe(true);
    expect(
      MainToHostControlSchema.safeParse({
        type: 'transfer',
        job: {
          id: 't1',
          sessionId: 's',
          direction: 'upload',
          sourcePath: 'C:/a.txt',
          targetDir: '/tmp',
          name: 'a.txt',
        },
      }).success,
    ).toBe(true);
  });

  it('F4 파일 작업 결과는 작업 종류별 스키마로 검증한다(session host → main → renderer)', () => {
    const ok = (kind: Parameters<typeof filesOpResultSchema>[0], value: unknown) =>
      filesOpResultSchema(kind).safeParse(value).success;
    const entry = { name: 'a.txt', type: 'file', size: 3, mtimeMs: 0, mode: 0o644 };
    expect(ok('list', { path: '/home/u', entries: [entry] })).toBe(true);
    expect(ok('list', { path: '/home/u', entries: [{ ...entry, type: 'socket' }] })).toBe(false);
    expect(ok('list', { path: '/home/u', entries: [{ ...entry, mode: 0o170000 }] })).toBe(false);
    expect(ok('list', { path: '/home/u', entries: [{ ...entry, name: '' }] })).toBe(false);
    expect(ok('list', { path: '/home/u', entries: [entry], extra: '<script>' })).toBe(false);
    expect(ok('list', '<img onerror>')).toBe(false);
    expect(ok('mkdir', null)).toBe(true);
    expect(ok('mkdir', { anything: 1 })).toBe(false);
    const status = { installed: true, rcFiles: ['.bashrc'], loginCovered: null };
    expect(ok('shellStatus', status)).toBe(true);
    expect(ok('shellInstall', { ...status, loginCovered: 'yes' })).toBe(false);
    expect(ok('installKey', { added: true })).toBe(true);
    expect(ok('installKey', { added: 'true' })).toBe(false);
    expect(Object.values(RENDERER_BOUND_SCHEMAS)).toContain(filesOpResultSchema('list'));
  });

  it('설정 기본값은 스키마를 통과한다', () => {
    expect(AppSettingsSchema.parse(defaultAppSettings())).toEqual(defaultAppSettings());
  });

  it('F5.3 화면 모드는 system·light·dark만 받고, 없는 기존 설정 파일도 그대로 읽는다', () => {
    const patch = (theme: unknown) =>
      RendererToMainRequestSchema.safeParse({ type: 'settings.update', patch: { ui: { theme } } })
        .success;
    expect(patch('light')).toBe(true);
    expect(patch('system')).toBe(true);
    expect(patch('blue')).toBe(false);
    const old = defaultAppSettings();
    expect('theme' in old.ui).toBe(false);
    expect(AppSettingsSchema.safeParse(old).success).toBe(true);
  });

  it('F7.7 키 생성·내보내기 요청: 형식은 ed25519·rsa만, 이름·passphrase 길이 제한', () => {
    const ok = (value: unknown) => RendererToMainRequestSchema.safeParse(value).success;
    const generate = { type: 'keys.generate', label: 'k', keyType: 'ed25519' };
    expect(ok({ ...generate, passphrasePolicy: 'ask' })).toBe(true);
    expect(ok({ ...generate, passphrase: 'pp', passphrasePolicy: 'vault' })).toBe(true);
    expect(ok({ ...generate, keyType: 'dsa', passphrasePolicy: 'ask' })).toBe(false);
    expect(ok({ ...generate, label: '', passphrasePolicy: 'ask' })).toBe(false);
    expect(ok({ ...generate, passphrase: 'x'.repeat(4097), passphrasePolicy: 'ask' })).toBe(false);
    expect(ok({ type: 'keys.export', keyId: 'k1' })).toBe(true);
  });

  it('F7.7 main↔session host 키 생성: 개인키는 host → main으로만 간다', () => {
    const toHost = (raw: unknown) => MainToHostControlSchema.safeParse(raw).success;
    const toMain = (raw: unknown) => HostToMainControlSchema.safeParse(raw).success;
    expect(toHost({ type: 'generateKey', requestId: 'r', keyType: 'rsa', comment: '' })).toBe(true);
    expect(
      toMain({ type: 'keyGenerated', requestId: 'r', result: { ok: true, privateKey: 'PEM' } }),
    ).toBe(true);
    expect(toMain({ type: 'keyGenerated', requestId: 'r', result: { ok: false } })).toBe(true);
  });

  it('F7.8 공개키 등록: renderer는 키 ID만 보내고, 키 내용이 든 작업은 main → host로만', () => {
    const ok = (value: unknown) => RendererToMainRequestSchema.safeParse(value).success;
    expect(ok({ type: 'keys.install', keyId: 'k1', sessionId: 's1' })).toBe(true);
    const installOp = { kind: 'installKey', publicKey: 'ssh-ed25519 AAAA' };
    expect(ok({ type: 'files.op', sessionId: 's1', op: installOp })).toBe(false);
    expect(
      MainToHostControlSchema.safeParse({
        type: 'files',
        requestId: 'r',
        sessionId: 's1',
        op: installOp,
      }).success,
    ).toBe(true);
  });

  it('F2.4b 알려진 호스트 요청: 줄 번호·형식·키 길이를 제한한다', () => {
    const ok = (value: unknown) => RendererToMainRequestSchema.safeParse(value).success;
    expect(ok({ type: 'knownHosts.list' })).toBe(true);
    const remove = { type: 'knownHosts.remove', line: 2, keyType: 'ssh-ed25519', key: 'AAAA' };
    expect(ok(remove)).toBe(true);
    expect(ok({ ...remove, line: 0 })).toBe(false);
    expect(ok({ ...remove, key: 'x'.repeat(16 * 1024 + 1) })).toBe(false);
  });

  it('D12 창 전체 화면 알림은 boolean만 담는다(DESIGN §4.2 신호등 여백)', () => {
    const event = (value: unknown) => MainToRendererEventSchema.safeParse(value).success;
    expect(event({ type: 'window.fullScreen', fullScreen: true })).toBe(true);
    expect(event({ type: 'window.fullScreen', fullScreen: 'yes' })).toBe(false);
  });

  it('알 수 없는 요청 채널은 거부한다', () => {
    expect(
      RendererToMainRequestSchema.safeParse({ type: 'fs.readFile', path: 'C:/' }).success,
    ).toBe(false);
  });
});
