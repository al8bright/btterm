export type { BtTermApi, SessionChannel, SessionHandlers } from '@btterm/core';

export const IPC = {
  invoke: 'btterm:invoke',
  event: 'btterm:event',
  port: 'btterm:port',
  /** preload → main 단방향: 끌어 놓은 파일 경로 등록 */
  dropped: 'btterm:dropped',
} as const;
