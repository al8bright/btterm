import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  HostToRendererFrameSchema,
  MainToRendererEventSchema,
  parsePlatformArg,
  type RendererToHostFrame,
} from '@btterm/core';
import { IPC, type BtTermApi, type SessionHandlers } from '../shared/api';

// preload는 MessagePort를 쥐고 renderer에는 도메인 함수만 노출한다(S1 결정 전 기본값, AGENTS §3).

const ports = new Map<string, MessagePort>();
const handlers = new Map<string, SessionHandlers>();
const queued = new Map<string, Array<{ port: MessagePort; raw: unknown }>>();

ipcRenderer.on(IPC.port, (event, payload: { sessionId?: unknown }) => {
  const [port] = event.ports;
  const sessionId = payload?.sessionId;
  if (!port || typeof sessionId !== 'string') return;
  // 재접속하면 같은 sessionId로 새 포트가 온다. 핸들러는 그대로 두고 포트만 바꾼다(F2.5).
  ports.set(sessionId, port);
  port.onmessage = (message) => deliver(sessionId, port, message.data);
  port.start();
});

function deliver(sessionId: string, port: MessagePort, raw: unknown): void {
  const target = handlers.get(sessionId);
  if (!target) {
    const list = queued.get(sessionId) ?? [];
    list.push({ port, raw });
    queued.set(sessionId, list);
    return;
  }
  const parsed = HostToRendererFrameSchema.safeParse(raw);
  if (!parsed.success) return;
  if (parsed.data.t === 'data') target.onData(parsed.data.data);
  else {
    target.onExit();
    port.close();
    if (ports.get(sessionId) === port) ports.delete(sessionId);
  }
}

function send(sessionId: string, frame: RendererToHostFrame): void {
  ports.get(sessionId)?.postMessage(frame);
}

const api: BtTermApi = {
  platform: parsePlatformArg(process.argv),
  invoke: (request) => ipcRenderer.invoke(IPC.invoke, request),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const parsed = MainToRendererEventSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.event, handler);
    return () => ipcRenderer.off(IPC.event, handler);
  },
  attachSession: (sessionId, sessionHandlers) => {
    handlers.set(sessionId, sessionHandlers);
    for (const { port, raw } of queued.get(sessionId) ?? []) deliver(sessionId, port, raw);
    queued.delete(sessionId);
    return {
      write: (data) => send(sessionId, { t: 'input', data }),
      resize: (cols, rows) => send(sessionId, { t: 'resize', cols, rows }),
      ack: (bytes) => send(sessionId, { t: 'ack', bytes }),
      detach: () => handlers.delete(sessionId),
    };
  },
  // 경로를 main 허용 목록에 등록한 뒤 돌려준다. renderer는 이 등록을 흉내 낼 수 없다.
  pathForFile: (file) => {
    if (!(file instanceof File)) return '';
    const path = webUtils.getPathForFile(file);
    if (path) ipcRenderer.send(IPC.dropped, path);
    return path;
  },
};

contextBridge.exposeInMainWorld('btterm', api);
