import { randomUUID } from 'node:crypto';
import type { MessagePortMain } from 'electron';
import {
  HostSession,
  KBD_INSTRUCTIONS_MAX,
  KBD_NAME_MAX,
  KBD_PROMPT_MAX,
  FINGERPRINT_MAX_LENGTH,
  HOST_KEY_MAX_LENGTH,
  KNOWN_HOST_KEY_TYPE,
  MainToHostControlSchema,
  type FramePort,
  type HistoryResult,
  type HostToMainControl,
  type MainToHostControl,
  type ResourceTracker,
  type SshTransport,
  type StatsResult,
} from '@btterm/core';
import { nodeClock } from '../shared/nodeClock';
import { FilesHost } from './files/FilesHost';
import { generateKey } from './ssh/keyGenerator';
import { inspectKey } from './ssh/keyInspector';

const PROBE_TIMEOUT_MS = 5000;
/** 탭을 닫을 때 부분 파일 정리를 기다리는 상한 */
const CLOSE_CLEANUP_MS = 3000;

type FilesMessage = Extract<
  MainToHostControl,
  {
    type:
      | 'files'
      | 'transfer'
      | 'transferCancel'
      | 'transferRetry'
      | 'transferDiscard'
      | 'conflictAnswer';
  }
>;

/** 파일 작업·전송 처리기(기본은 FilesHost) */
export interface HostFiles {
  handle(message: FilesMessage): Promise<void>;
  discardSession(sessionId: string): Promise<void>;
  sessionEnded(sessionId: string): void;
}

export interface HostControlDeps {
  post(message: HostToMainControl): void;
  transport: SshTransport;
  tracker: ResourceTracker;
  /** 테스트에서 바꿔 끼운다 */
  createFiles?(deps: {
    session(sessionId: string): HostSession | undefined;
    post(message: HostToMainControl): void;
    tracker: ResourceTracker;
  }): HostFiles;
}

/**
 * session host의 parentPort 메시지 처리(진입점 index.ts가 연결한다).
 * 받은 메시지는 스키마로 검증하고, 종류마다 빠짐없이 분기한다(never 검사).
 */
export function createHostControl(deps: HostControlDeps): {
  onMessage(data: unknown, ports: readonly MessagePortMain[]): void;
} {
  const sessions = new Map<string, HostSession>();
  const pendingHostKeys = new Map<string, (accept: boolean) => void>();
  const pendingKbd = new Map<string, (answers: string[]) => void>();
  const post = deps.post;
  const filesDeps = {
    session: (sessionId: string) => sessions.get(sessionId),
    post,
    tracker: deps.tracker,
  };
  const files = deps.createFiles ? deps.createFiles(filesDeps) : new FilesHost(filesDeps);

  function open(message: Extract<MainToHostControl, { type: 'open' }>, port: MessagePortMain) {
    const { sessionId } = message;
    // 같은 sessionId로 다시 열면(재접속) 이전 세션을 먼저 정리한다.
    sessions.get(sessionId)?.close();

    const framePort: FramePort = {
      post: (frame) => port.postMessage(frame),
      onFrame: (listener) => {
        const handler = (e: Electron.MessageEvent) => listener(e.data);
        port.on('message', handler);
        port.start();
        return { dispose: () => port.off('message', handler) };
      },
      close: () => port.close(),
    };

    const session = new HostSession({
      transport: deps.transport,
      clock: nodeClock,
      tracker: deps.tracker,
      port: framePort,
      reportState: (state, errorCode) => {
        if ((state === 'closed' || state === 'failed') && sessions.get(sessionId) === session) {
          sessions.delete(sessionId);
          files.sessionEnded(sessionId);
        }
        post({ type: 'state', sessionId, state, ...(errorCode ? { errorCode } : {}) });
      },
      verifyHostKey: (key) => {
        // 경계 스키마를 넘지 못할 키는 묻지 않고 거부한다(응답 없는 확인 요청으로 멈추지 않게)
        if (
          !KNOWN_HOST_KEY_TYPE.test(key.keyType) ||
          key.key.length > HOST_KEY_MAX_LENGTH ||
          key.fingerprint.length > FINGERPRINT_MAX_LENGTH
        ) {
          return Promise.resolve(false);
        }
        return request(pendingHostKeys, (requestId) =>
          post({
            type: 'hostKeyCheck',
            requestId,
            sessionId,
            host: message.host,
            port: message.port,
            ...key,
          }),
        );
      },
      keyboardInteractive: (kbd) =>
        request(pendingKbd, (requestId) =>
          post({
            type: 'kbdPrompt',
            requestId,
            sessionId,
            // 서버가 정하는 문자열: 경계 상한에 맞춰 자른다
            name: kbd.name.slice(0, KBD_NAME_MAX),
            instructions: kbd.instructions.slice(0, KBD_INSTRUCTIONS_MAX),
            prompts: kbd.prompts
              .slice(0, 16)
              .map((p) => ({ prompt: p.prompt.slice(0, KBD_PROMPT_MAX), echo: p.echo })),
          }),
        ),
    });
    sessions.set(sessionId, session);
    void session.open({
      host: message.host,
      port: message.port,
      username: message.username,
      keepaliveSec: message.keepaliveSec,
      auth: message.auth,
      size: message.size,
      startupCommand: message.startupCommand,
      knownHostKeyTypes: message.knownHostKeyTypes,
    });
  }

  function onMessage(data: unknown, ports: readonly MessagePortMain[]): void {
    const parsed = MainToHostControlSchema.safeParse(data);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.type) {
      case 'open': {
        const port = ports[0];
        if (port) open(message, port);
        return;
      }
      case 'close': {
        // 탭을 닫음: 남은 부분 파일을 지운 뒤(최대 3초) 세션을 닫는다(보안 리뷰 L2)
        const id = message.sessionId;
        const limit = new Promise((resolve) => setTimeout(resolve, CLOSE_CLEANUP_MS));
        void Promise.race([files.discardSession(id), limit]).finally(() =>
          sessions.get(id)?.close(),
        );
        return;
      }
      case 'hostKeyDecision':
        settle(pendingHostKeys, message.requestId, message.accept);
        return;
      case 'kbdAnswers':
        settle(pendingKbd, message.requestId, message.answers);
        return;
      case 'probe':
        void sessions.get(message.sessionId)?.probe(PROBE_TIMEOUT_MS);
        return;
      case 'readHistory': {
        const session = sessions.get(message.sessionId);
        const reply = (result: HistoryResult) =>
          post({ type: 'historyResult', requestId: message.requestId, result });
        if (!session) reply({ status: 'unavailable', entries: [] });
        else session.readHistory().then(reply, () => reply({ status: 'unavailable', entries: [] }));
        return;
      }
      case 'readStats': {
        const session = sessions.get(message.sessionId);
        const reply = (result: StatsResult) =>
          post({ type: 'statsResult', requestId: message.requestId, result });
        if (!session) reply({ status: 'unavailable' });
        else session.readStats().then(reply, () => reply({ status: 'unavailable' }));
        return;
      }
      case 'files':
      case 'transfer':
      case 'transferCancel':
      case 'transferRetry':
      case 'transferDiscard':
      case 'conflictAnswer':
        void files.handle(message);
        return;
      case 'generateKey':
        void generateKey(message).then(
          (keys) =>
            post({
              type: 'keyGenerated',
              requestId: message.requestId,
              result: { ok: true, privateKey: keys.privateKey },
            }),
          () => post({ type: 'keyGenerated', requestId: message.requestId, result: { ok: false } }),
        );
        return;
      case 'inspectKey':
        post({
          type: 'keyInfo',
          requestId: message.requestId,
          result: inspectKey(message.privateKey, message.passphrase),
        });
        return;
      default: {
        // 새 메시지 종류를 더하면 여기서 타입 오류가 난다(조용히 버려지지 않게)
        const unhandled: never = message;
        return unhandled;
      }
    }
  }

  return { onMessage };
}

function settle<T>(pending: Map<string, (value: T) => void>, requestId: string, value: T): void {
  pending.get(requestId)?.(value);
  pending.delete(requestId);
}

function request<T>(
  pending: Map<string, (value: T) => void>,
  send: (requestId: string) => void,
): Promise<T> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    pending.set(requestId, resolve);
    send(requestId);
  });
}
