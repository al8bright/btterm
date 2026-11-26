/// <reference types="vite/client" />
import type { BtTermApi } from '@btterm/core';

declare global {
  interface Window {
    btterm: BtTermApi;
  }
}

export {};
