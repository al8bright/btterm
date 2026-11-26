/// <reference types="vite/client" />

declare global {
  interface Window {
    __bttermTest?: {
      bufferText(sessionId?: string): string;
      receivedBytes(sessionId: string): number;
    };
  }
  /** E2E 빌드에서만 true. 번들러(define)가 상수로 바꾼다. */
  const __BTTERM_E2E__: boolean;
}

export {};
