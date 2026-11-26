import { randomUUID } from 'node:crypto';
import type { MessagePortMain } from 'electron';
import {
  HostSession,
  MainToHostControlSchema,
  ResourceTracker,
  type FramePort,
  type HistoryResult,
  type HostToMainControl,
  type MainToHostControl,
  type StatsResult,
} from '@btterm/core';
import { nodeClock } from '../shared/nodeClock';
import { FilesHost } from './files/FilesHost';
import { generateKey } from './ssh/keyGenerator';
import { inspectKey } from './ssh/keyInspector';
import { Ssh2Transport } from './ssh/Ssh2Transport';

// session host(utilityProcess) 진입점. ssh2는 이 프로세스에서만 로드한다(AGENTS §3).

const PROBE_TIMEOUT_MS = 5000;

const sessions = new Map<string, HostSession>();
const pendingHostKeys = new Map<string, (accept: boolean) => void>();
const pendingKbd = new Map<string, (answers: string[]) => void>();
const tracker = new ResourceTracker();
const transport = new Ssh2Transport();
const filesHost = new FilesHost({
  session: (sessionId) => sessions.get(sessionId),
  post: (message) => post(message),
  tracker,
});

function post(message: HostToMainControl): void {
  process.parentPort.postMessage(message);
}

process.parentPort.on('message', (event) => {
  const parsed = MainToHostControlSchema.safeParse(event.data);
  if (!parsed.success) return;
  const message = parsed.data;
  switch (message.type) {
    case 'open': {
      const port = event.ports[0];
      if (port) open(message, port);
      return;
    }
    case 'close': {
      // 탭을 닫음: 남은 부분 파일을 지운 뒤(최대 3초) 세션을 닫는다(보안 리뷰 L2)
      const id = message.sessionId;
      const limit = new Promise((resolve) => setTimeout(resolve, 3000));
      void Promise.race([filesHost.discardSession(id), limit]).finally(() =>
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
    case 'conflictAnswer':
      void filesHost.handle(message);
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
  }
});

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

function open(message: Extract<MainToHostControl, { type: 'open' }>, port: MessagePortMain): void {
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
    transport,
    clock: nodeClock,
    tracker,
    port: framePort,
    reportState: (state, errorCode) => {
      if ((state === 'closed' || state === 'failed') && sessions.get(sessionId) === session) {
        sessions.delete(sessionId);
        filesHost.sessionEnded(sessionId);
      }
      post({ type: 'state', sessionId, state, ...(errorCode ? { errorCode } : {}) });
    },
    verifyHostKey: (key) =>
      request(pendingHostKeys, (requestId) =>
        post({
          type: 'hostKeyCheck',
          requestId,
          sessionId,
          host: message.host,
          port: message.port,
          ...key,
        }),
      ),
    keyboardInteractive: (kbd) =>
      request(pendingKbd, (requestId) => post({ type: 'kbdPrompt', requestId, sessionId, ...kbd })),
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
  });
}
