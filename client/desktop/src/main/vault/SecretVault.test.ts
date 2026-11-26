import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretVault, VaultUnavailableError, type SafeStoragePort } from './SecretVault';

/** 테스트용 safeStorage. 실제 DPAPI 대신 뒤집기 + 표식. */
class FakeSafeStorage implements SafeStoragePort {
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

let dir: string;
let ids = 0;
const nextId = () => `sec-${++ids}`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-vault-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('SecretVault', () => {
  it('저장한 비밀을 같은 참조로 다시 읽는다', async () => {
    const vault = await SecretVault.open(join(dir, 'vault.json'), new FakeSafeStorage(), nextId);
    const ref = await vault.put(enc('p@ssw0rd'));
    expect(dec(await vault.get(ref))).toBe('p@ssw0rd');
  });

  it('다시 열어도 읽힌다(DEK는 safeStorage로 보호된 채 저장)', async () => {
    const path = join(dir, 'vault.json');
    const ref = await (await SecretVault.open(path, new FakeSafeStorage(), nextId)).put(enc('x'));
    const reopened = await SecretVault.open(path, new FakeSafeStorage(), nextId);
    expect(dec(await reopened.get(ref))).toBe('x');
  });

  it('SEC-2 safeStorage를 쓸 수 없으면 열기를 거부한다(평문 폴백 없음)', async () => {
    await expect(
      SecretVault.open(join(dir, 'vault.json'), new FakeSafeStorage(false), nextId),
    ).rejects.toBeInstanceOf(VaultUnavailableError);
  });

  it('AC26 데이터 폴더 어디에도 평문 비밀이 남지 않는다', async () => {
    const vault = await SecretVault.open(join(dir, 'vault.json'), new FakeSafeStorage(), nextId);
    await vault.put(enc('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n'));
    await vault.put(enc('hunter2-passphrase'));
    await vault.put(enc('second-write-to-create-bak'));
    for (const name of await readdir(dir)) {
      const content = await readFile(join(dir, name), 'utf8');
      expect(content, name).not.toContain('PRIVATE KEY');
      expect(content, name).not.toContain('hunter2');
    }
  });

  it('다른 레코드의 암호문으로 바꿔치기하면 복호화가 실패한다(AAD=참조)', async () => {
    const path = join(dir, 'vault.json');
    const vault = await SecretVault.open(path, new FakeSafeStorage(), nextId);
    const a = await vault.put(enc('a'));
    const b = await vault.put(enc('b'));
    const raw = JSON.parse(await readFile(path, 'utf8'));
    raw.records[a] = raw.records[b];
    await import('node:fs/promises').then((fs) => fs.writeFile(path, JSON.stringify(raw)));
    const reopened = await SecretVault.open(path, new FakeSafeStorage(), nextId);
    await expect(reopened.get(a)).rejects.toThrow();
  });

  it('remove한 참조는 더 이상 읽을 수 없다', async () => {
    const vault = await SecretVault.open(join(dir, 'vault.json'), new FakeSafeStorage(), nextId);
    const ref = await vault.put(enc('x'));
    await vault.remove(ref);
    await expect(vault.get(ref)).rejects.toThrow(/없는 비밀/);
  });

  it('동시에 저장해도 모두 남는다', async () => {
    const path = join(dir, 'vault.json');
    const vault = await SecretVault.open(path, new FakeSafeStorage(), nextId);
    const refs = await Promise.all([1, 2, 3, 4, 5].map((n) => vault.put(enc(String(n)))));
    const again = await SecretVault.open(path, new FakeSafeStorage(), nextId);
    for (const [i, ref] of refs.entries()) expect(dec(await again.get(ref))).toBe(String(i + 1));
  });
});
