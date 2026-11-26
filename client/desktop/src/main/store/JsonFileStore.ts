import { copyFile, readFile } from 'node:fs/promises';
import { writeTextAtomic } from './atomicWrite';

export type StoreReadResult = { source: 'none' } | { source: 'main' | 'backup'; data: unknown };

/**
 * JSON 파일 저장소(F6.2). 쓰기는 임시 파일 → fsync → rename으로 원자적으로 하고,
 * 직전 내용은 .bak으로 남긴다. 본 파일이 깨졌거나 없으면 .bak으로 복구한다(AC21).
 */
export class JsonFileStore {
  constructor(private readonly path: string) {}

  get backupPath(): string {
    return `${this.path}.bak`;
  }

  async read(): Promise<StoreReadResult> {
    const main = await readJson(this.path);
    if (main.kind === 'ok') return { source: 'main', data: main.data };
    const backup = await readJson(this.backupPath);
    if (backup.kind === 'ok') return { source: 'backup', data: backup.data };
    if (main.kind === 'missing' && backup.kind === 'missing') return { source: 'none' };
    throw new Error(`corrupt: ${this.path} 와 .bak 모두 읽을 수 없습니다`);
  }

  async write(data: unknown): Promise<void> {
    await writeTextAtomic(this.path, `${JSON.stringify(data, null, 2)}\n`, async () => {
      if ((await readJson(this.path)).kind === 'ok') await copyFile(this.path, this.backupPath);
    });
  }
}

type JsonRead = { kind: 'ok'; data: unknown } | { kind: 'missing' } | { kind: 'corrupt' };

async function readJson(path: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  try {
    return { kind: 'ok', data: JSON.parse(text) };
  } catch {
    return { kind: 'corrupt' };
  }
}
