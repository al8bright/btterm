import { SftpError, type RemoteEntry, type SftpSession } from '../sftp/SftpSession';
import type { TransferSink, TransferSource } from '../sftp/TransferQueue';

interface Node {
  type: 'file' | 'dir';
  data: Uint8Array;
  mode: number;
  mtimeMs: number;
}

/** 메모리 원격 파일 시스템. 홈은 /home/<user>. 'denied' 경로는 읽기·쓰기를 거부한다. */
export class FakeRemoteFs {
  readonly nodes = new Map<string, Node>();
  readonly denied = new Set<string>();

  constructor(readonly home: string) {
    this.nodes.set('/', dir());
    let path = '';
    for (const part of home.split('/').filter(Boolean)) {
      path += `/${part}`;
      this.nodes.set(path, dir());
    }
  }

  resolve(path: string): string {
    const absolute = path.startsWith('/') ? path : `${this.home}/${path}`;
    const parts: string[] = [];
    for (const part of absolute.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return `/${parts.join('/')}`;
  }

  writeText(path: string, text: string): void {
    this.nodes.set(this.resolve(path), {
      type: 'file',
      data: new TextEncoder().encode(text),
      mode: 0o644,
      mtimeMs: 0,
    });
  }

  readText(path: string): string | undefined {
    const node = this.nodes.get(this.resolve(path));
    return node?.type === 'file' ? new TextDecoder().decode(node.data) : undefined;
  }
}

function dir(): Node {
  return { type: 'dir', data: new Uint8Array(), mode: 0o755, mtimeMs: 0 };
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

export class FakeSftp implements SftpSession {
  closed = false;

  constructor(private readonly fs: FakeRemoteFs) {}

  async realpath(path: string): Promise<string> {
    const resolved = this.fs.resolve(path);
    if (!this.fs.nodes.has(resolved)) throw new SftpError('missing');
    return resolved;
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const resolved = this.#existing(path, 'dir');
    const prefix = resolved === '/' ? '/' : `${resolved}/`;
    return [...this.fs.nodes]
      .filter(
        ([p]) => p !== resolved && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'),
      )
      .map(([p, node]) => entry(p.slice(prefix.length), node))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const resolved = this.fs.resolve(path);
    const node = this.fs.nodes.get(resolved);
    return node ? entry(resolved.slice(resolved.lastIndexOf('/') + 1), node) : null;
  }

  async mkdir(path: string): Promise<void> {
    const resolved = this.#writable(path);
    if (this.fs.nodes.has(resolved)) throw new SftpError('exists');
    this.fs.nodes.set(resolved, dir());
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.fs.resolve(from);
    const target = this.#writable(to);
    if (!this.fs.nodes.has(source)) throw new SftpError('missing');
    if (this.fs.nodes.has(target)) throw new SftpError('exists');
    for (const [p, node] of [...this.fs.nodes]) {
      if (p === source || p.startsWith(`${source}/`)) {
        this.fs.nodes.delete(p);
        this.fs.nodes.set(target + p.slice(source.length), node);
      }
    }
  }

  async removeFile(path: string): Promise<void> {
    const resolved = this.#existing(path, 'file');
    this.fs.nodes.delete(resolved);
  }

  async removeDir(path: string): Promise<void> {
    const resolved = this.#existing(path, 'dir');
    if ([...this.fs.nodes.keys()].some((p) => p.startsWith(`${resolved}/`))) {
      throw new SftpError('not-empty');
    }
    this.fs.nodes.delete(resolved);
  }

  async chmod(path: string, mode: number): Promise<void> {
    const resolved = this.fs.resolve(path);
    const node = this.fs.nodes.get(resolved);
    if (!node) throw new SftpError('missing');
    node.mode = mode & 0o7777;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const resolved = this.#existing(path, 'file');
    return this.fs.nodes.get(resolved)!.data.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.#put(path, data);
  }

  async createFile(path: string, data: Uint8Array, mode: number): Promise<void> {
    const resolved = this.#writable(path);
    if (this.fs.nodes.has(resolved)) throw new SftpError('exists');
    this.fs.nodes.set(resolved, {
      type: 'file',
      data: data.slice(),
      mode: mode & 0o777,
      mtimeMs: 0,
    });
  }

  async appendFile(path: string, data: Uint8Array, mode: number): Promise<void> {
    const resolved = this.#writable(path);
    const node = this.fs.nodes.get(resolved);
    if (node && node.type !== 'file') throw new SftpError('failure');
    if (node) node.data = concat([node.data, data]);
    else this.fs.nodes.set(resolved, { type: 'file', data: data.slice(), mode, mtimeMs: 0 });
  }

  /** 메모리 파일 시스템에서는 한 번에 바뀌므로 그대로 쓴다. 권한은 기존 비트, 새 파일은 600(F4.5) */
  async writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
    const resolved = this.#writable(path);
    const existing = this.fs.nodes.get(resolved);
    const mode = existing ? existing.mode & 0o777 : 0o600;
    this.fs.nodes.set(resolved, { type: 'file', data: data.slice(), mode, mtimeMs: 0 });
    // 실제 어댑터처럼 지난번에 남은 임시 파일을 치운다
    this.fs.nodes.delete(`${resolved}.btterm-tmp`);
  }

  #put(path: string, data: Uint8Array): void {
    const resolved = this.#writable(path);
    const mode = this.fs.nodes.get(resolved)?.mode ?? 0o644;
    this.fs.nodes.set(resolved, { type: 'file', data: data.slice(), mode, mtimeMs: 0 });
  }

  async replace(from: string, to: string): Promise<void> {
    const source = this.#existing(from, 'file');
    const target = this.#writable(to);
    this.fs.nodes.set(target, this.fs.nodes.get(source)!);
    this.fs.nodes.delete(source);
  }

  async openRead(path: string, start = 0): Promise<TransferSource> {
    const data = await this.readFile(path);
    let offset = start;
    return {
      size: data.length,
      read: async (max) => {
        if (offset >= data.length) return null;
        const chunk = data.slice(offset, offset + max);
        offset += chunk.length;
        return chunk;
      },
      close: async () => undefined,
    };
  }

  async openWrite(path: string, offset = 0): Promise<TransferSink> {
    const resolved = this.#writable(path);
    // 새로 쓰기는 배타 생성(보안 리뷰 M1). 이어 쓰기는 일반 파일만
    const current = this.fs.nodes.get(resolved);
    if (offset === 0 && current) throw new SftpError('exists');
    if (offset > 0 && current?.type !== 'file') throw new SftpError('failure');
    const existing = this.fs.nodes.get(resolved)?.data ?? new Uint8Array();
    const parts: Uint8Array[] = offset > 0 ? [existing.slice(0, offset)] : [];
    this.fs.nodes.set(resolved, { type: 'file', data: concat(parts), mode: 0o644, mtimeMs: 0 });
    const flush = () => {
      this.fs.nodes.set(resolved, { type: 'file', data: concat(parts), mode: 0o644, mtimeMs: 0 });
    };
    return {
      write: async (chunk) => {
        parts.push(chunk.slice());
      },
      finish: async () => flush(),
      keep: async () => flush(),
      abort: async () => {
        this.fs.nodes.delete(resolved);
      },
    };
  }

  close(): void {
    this.closed = true;
  }

  #existing(path: string, type: Node['type']): string {
    const resolved = this.fs.resolve(path);
    if (this.fs.denied.has(resolved)) throw new SftpError('denied');
    const node = this.fs.nodes.get(resolved);
    if (!node || node.type !== type) throw new SftpError('missing');
    return resolved;
  }

  #writable(path: string): string {
    const resolved = this.fs.resolve(path);
    const parent = parentOf(resolved);
    if (this.fs.denied.has(resolved) || this.fs.denied.has(parent)) throw new SftpError('denied');
    if (this.fs.nodes.get(parent)?.type !== 'dir') throw new SftpError('missing');
    return resolved;
  }
}

function entry(name: string, node: Node): RemoteEntry {
  return {
    name,
    type: node.type,
    size: node.type === 'file' ? node.data.length : 0,
    mtimeMs: node.mtimeMs,
    mode: node.mode,
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    data.set(p, o);
    o += p.length;
  }
  return data;
}
