import type { KeymapPlatform } from '../keymap/keymap';
import type { MainToRendererEvent, RendererToMainRequest } from './contracts';

/** preload가 renderer에 노출하는 도메인 API(window.btterm). 원시 ipcRenderer·포트는 노출하지 않는다. */
export interface BtTermApi {
  /** OS 플래그(D12). renderer는 OS를 직접 판단하지 않고 이 값으로 키맵·창 크롬을 고른다 */
  readonly platform: KeymapPlatform;
  invoke(request: RendererToMainRequest): Promise<unknown>;
  onEvent(listener: (event: MainToRendererEvent) => void): () => void;
  attachSession(sessionId: string, handlers: SessionHandlers): SessionChannel;
  /** 탐색기에서 끌어 놓은 파일의 로컬 경로(F4.3). renderer(sandbox)는 File.path를 볼 수 없다 */
  pathForFile(file: unknown): string;
}

export interface SessionHandlers {
  onData(bytes: Uint8Array): void;
  onExit(): void;
}

export interface SessionChannel {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  ack(bytes: number): void;
  detach(): void;
}
