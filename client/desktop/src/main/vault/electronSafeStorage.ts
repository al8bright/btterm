import { safeStorage } from 'electron';
import type { SafeStoragePort } from './SecretVault';

/**
 * Electron safeStorage 비동기 API 어댑터(main 전용, app ready 이후).
 * 동기 API는 Electron 46에서 제거 예정이라 쓰지 않는다.
 */
export const electronSafeStorage: SafeStoragePort = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: async (plain) => new Uint8Array(await safeStorage.encryptStringAsync(plain)),
  decrypt: async (data) => (await safeStorage.decryptStringAsync(Buffer.from(data))).result,
};
