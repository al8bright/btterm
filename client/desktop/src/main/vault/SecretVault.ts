import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { JsonFileStore } from '../store/JsonFileStore';

/** Electron safeStorage(main 전용, whenReady 이후)를 감싸는 포트. 테스트는 가짜를 주입한다. */
export interface SafeStoragePort {
  isAvailable(): Promise<boolean>;
  encrypt(plain: string): Promise<Uint8Array>;
  decrypt(data: Uint8Array): Promise<string>;
}

export class VaultUnavailableError extends Error {
  constructor() {
    super('OS 보호 저장소(safeStorage)를 쓸 수 없어 비밀을 저장하지 않습니다(SEC-2)');
    this.name = 'VaultUnavailableError';
  }
}

interface VaultRecord {
  iv: string;
  tag: string;
  ct: string;
}

interface VaultFile {
  version: 1;
  wrappedDek: string;
  records: Record<string, VaultRecord>;
}

/**
 * 비밀 보관소(D9). 레코드마다 AES-256-GCM(AAD = 참조 ID)으로 암호화하고,
 * DEK는 safeStorage로 보호해 저장한다. M2 마스터 비밀번호는 DEK 래핑만 바꾼다.
 */
export class SecretVault {
  #writes: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly store: JsonFileStore,
    private readonly dek: Buffer,
    private file: VaultFile,
    private readonly nextId: () => string,
  ) {}

  static async open(
    path: string,
    safeStorage: SafeStoragePort,
    nextId: () => string,
  ): Promise<SecretVault> {
    if (!(await safeStorage.isAvailable())) throw new VaultUnavailableError();
    const store = new JsonFileStore(path);
    const existing = await store.read();
    if (existing.source === 'none') {
      const dek = randomBytes(32);
      const wrapped = await safeStorage.encrypt(dek.toString('base64'));
      const file: VaultFile = {
        version: 1,
        wrappedDek: Buffer.from(wrapped).toString('base64'),
        records: {},
      };
      await store.write(file);
      return new SecretVault(store, dek, file, nextId);
    }
    const file = existing.data as VaultFile;
    const dekText = await safeStorage.decrypt(Buffer.from(file.wrappedDek, 'base64'));
    return new SecretVault(store, Buffer.from(dekText, 'base64'), file, nextId);
  }

  async put(plain: Uint8Array): Promise<string> {
    const ref = this.nextId();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.dek, iv);
    cipher.setAAD(Buffer.from(ref, 'utf8'));
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    this.file = {
      ...this.file,
      records: {
        ...this.file.records,
        [ref]: {
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          ct: ct.toString('base64'),
        },
      },
    };
    await this.#persist();
    return ref;
  }

  /** 쓰기를 차례로 하고, 쓸 때마다 그 시점의 최신 내용을 쓴다(동시에 저장해도 유실 없음) */
  #persist(): Promise<void> {
    const run = this.#writes.then(() => this.store.write(this.file));
    this.#writes = run.catch(() => undefined);
    return run;
  }

  has(ref: string): boolean {
    return Object.hasOwn(this.file.records, ref);
  }

  async get(ref: string): Promise<Uint8Array> {
    const record = this.file.records[ref];
    if (!record) throw new Error(`없는 비밀 참조: ${ref}`);
    const decipher = createDecipheriv('aes-256-gcm', this.dek, Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(ref, 'utf8'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return new Uint8Array(
      Buffer.concat([decipher.update(Buffer.from(record.ct, 'base64')), decipher.final()]),
    );
  }

  async remove(ref: string): Promise<void> {
    const records = { ...this.file.records };
    delete records[ref];
    this.file = { ...this.file, records };
    await this.#persist();
  }
}
