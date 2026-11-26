import type { SafeStoragePort } from '../src/main/vault/SecretVault';

/** 테스트용 safeStorage. 실제 DPAPI·키체인 대신 뒤집기 + 표식(평문이 그대로 남지 않게) */
export class FakeSafeStorage implements SafeStoragePort {
  constructor(public available = true) {}
  async isAvailable() {
    return this.available;
  }
  async encrypt(plain: string) {
    return new TextEncoder().encode(`dpapi:${[...plain].reverse().join('')}`);
  }
  async decrypt(data: Uint8Array) {
    const text = new TextDecoder().decode(data);
    if (!text.startsWith('dpapi:')) throw new Error('bad blob');
    return [...text.slice(6)].reverse().join('');
  }
}
