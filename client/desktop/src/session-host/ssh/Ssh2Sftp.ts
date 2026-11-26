import type { SFTPWrapper, Stats } from 'ssh2';
import {
  SftpError,
  type RemoteEntry,
  type SftpErrorCode,
  type SftpSession,
  type TransferSink,
  type TransferSource,
} from '@btterm/core';

// SFTP 상태 코드(draft-ietf-secsh-filexfer-02)
const NO_SUCH_FILE = 2;
const PERMISSION_DENIED = 3;
const FILE_ALREADY_EXISTS = 11;

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

/** 새로 만드는 rc·스크립트 권한(F4.5): 비밀이 들 수 있으니 본인만 */
const NEW_FILE_MODE = 0o600;
/** SFTP 쓰기 한 번의 크기(서버 최대 패킷보다 작게) */
const WRITE_CHUNK = 32 * 1024;

function toError(error: Error & { code?: unknown }): SftpError {
  let code: SftpErrorCode = 'failure';
  if (error.code === NO_SUCH_FILE) code = 'missing';
  else if (error.code === PERMISSION_DENIED) code = 'denied';
  else if (error.code === FILE_ALREADY_EXISTS) code = 'exists';
  return new SftpError(code, error.message);
}

function toEntry(name: string, stats: Stats): RemoteEntry {
  const kind = stats.mode & S_IFMT;
  return {
    name,
    type:
      kind === S_IFDIR ? 'dir' : kind === S_IFREG ? 'file' : kind === S_IFLNK ? 'link' : 'other',
    // 서버가 크기·시각을 주지 않으면(속성 플래그 없음) NaN이 되지 않게 0으로 둔다(경계 스키마)
    size: Number.isFinite(stats.size) ? stats.size : 0,
    mtimeMs: Number.isFinite(stats.mtime) ? stats.mtime * 1000 : 0,
    mode: stats.mode & 0o7777,
  };
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** ssh2 SFTPWrapper 어댑터(F4.1). session host에서만 쓴다. */
export class Ssh2Sftp implements SftpSession {
  readonly #pending = new Set<(error: SftpError) => void>();
  #closed = false;

  constructor(private readonly sftp: SFTPWrapper) {
    // 연결이 끊기면 ssh2는 대기 중인 요청의 콜백을 부르지 않는다. 채널이 닫히면 모두 실패로 끝낸다(AC12).
    sftp.on('close', () => {
      this.#closed = true;
      for (const reject of [...this.#pending]) reject(new SftpError('failure', 'SFTP 채널 닫힘'));
      this.#pending.clear();
    });
  }

  #call<T>(run: (done: (err: Error | null | undefined, value?: T) => void) => void): Promise<T> {
    if (this.#closed) return Promise.reject(new SftpError('failure', 'SFTP 채널 닫힘'));
    return new Promise((resolve, reject) => {
      const fail = (error: SftpError) => reject(error);
      this.#pending.add(fail);
      run((err, value) => {
        this.#pending.delete(fail);
        if (err) reject(toError(err));
        else resolve(value as T);
      });
    });
  }

  realpath(path: string): Promise<string> {
    return this.#call((done) => this.sftp.realpath(path, done));
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const items = await this.#call<Array<{ filename: string; attrs: Stats }>>((done) =>
      this.sftp.readdir(path, done),
    );
    return items
      .filter((item) => item.filename !== '.' && item.filename !== '..')
      .map((item) => toEntry(item.filename, item.attrs))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    try {
      return toEntry(
        baseName(path),
        await this.#call<Stats>((done) => this.sftp.lstat(path, done)),
      );
    } catch (error) {
      if (error instanceof SftpError && error.code === 'missing') return null;
      throw error;
    }
  }

  mkdir(path: string): Promise<void> {
    return this.#call((done) => this.sftp.mkdir(path, done));
  }

  rename(from: string, to: string): Promise<void> {
    return this.#call((done) => this.sftp.rename(from, to, done));
  }

  removeFile(path: string): Promise<void> {
    return this.#call((done) => this.sftp.unlink(path, done));
  }

  removeDir(path: string): Promise<void> {
    return this.#call((done) => this.sftp.rmdir(path, done));
  }

  chmod(path: string, mode: number): Promise<void> {
    return this.#call((done) => this.sftp.chmod(path, mode, done));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = await this.#call<Buffer>((done) => this.sftp.readFile(path, done));
    return new Uint8Array(data);
  }

  writeFile(path: string, data: Uint8Array): Promise<void> {
    return this.#call((done) => this.sftp.writeFile(path, Buffer.from(data), done));
  }

  /** 'a'로 열어 끝에 쓴다. mode는 새로 만들 때만 적용된다(서버 umask를 거침) */
  appendFile(path: string, data: Uint8Array, mode: number): Promise<void> {
    return this.#call((done) =>
      this.sftp.appendFile(path, Buffer.from(data), { mode, flag: 'a' }, done),
    );
  }

  /** 배타 생성(wx) + 처음부터 mode. umask로 줄어든 권한은 핸들로 다시 맞춘다(경로를 다시 따라가지 않게) */
  async createFile(path: string, data: Uint8Array, mode: number): Promise<void> {
    const perm = mode & 0o777;
    const handle = await this.#call<Buffer>((done) =>
      this.sftp.open(path, 'wx', { mode: perm }, done),
    );
    try {
      await this.#call((done) => this.sftp.fchmod(handle, perm, done));
      const buffer = Buffer.from(data);
      let offset = 0;
      while (offset < buffer.length) {
        const length = Math.min(buffer.length - offset, WRITE_CHUNK);
        await this.#call((done) => this.sftp.write(handle, buffer, offset, length, offset, done));
        offset += length;
      }
    } catch (error) {
      await this.#call((done) => this.sftp.close(handle, done)).catch(() => undefined);
      await this.removeFile(path).catch(() => undefined);
      throw error;
    }
    await this.#call((done) => this.sftp.close(handle, done));
  }

  async writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
    // 링크(dotfile 관리 도구 등)는 링크 자체가 아니라 가리키는 파일을 바꾼다.
    const existing = await this.stat(path);
    const target = existing?.type === 'link' ? await this.realpath(path) : path;
    const current = existing?.type === 'link' ? await this.stat(target) : existing;
    // 바꿔 넣으면 임시 파일의 권한이 남으므로 원래 권한(링크면 대상의 권한)으로 처음부터 만든다(F4.5)
    const mode = current ? current.mode & 0o777 : NEW_FILE_MODE;
    const temp = `${target}.btterm-tmp`;
    // 지난번에 끊겨 남은 임시 파일은 이름만 지운다(링크면 링크만). 배타 생성이 실패하지 않게
    if (await this.stat(temp)) await this.removeFile(temp);
    await this.createFile(temp, data, mode);
    try {
      await this.#replace(temp, target);
    } catch (error) {
      await this.removeFile(temp).catch(() => undefined);
      throw error;
    }
  }

  replace(from: string, to: string): Promise<void> {
    return this.#replace(from, to);
  }

  /** posix-rename(OpenSSH 확장)이 있으면 덮어쓰기 이동, 없으면 지우고 이동한다. */
  #replace(from: string, to: string): Promise<void> {
    const sftp = this.sftp as SFTPWrapper & {
      ext_openssh_rename?(src: string, dest: string, cb: (err?: Error | null) => void): void;
    };
    if (sftp.ext_openssh_rename) {
      return this.#call((done) => sftp.ext_openssh_rename!(from, to, done));
    }
    return this.removeFile(to)
      .catch(() => undefined)
      .then(() => this.rename(from, to));
  }

  async openRead(path: string, offset = 0): Promise<TransferSource> {
    const handle = await this.#call<Buffer>((done) => this.sftp.open(path, 'r', done));
    const stats = await this.#call<Stats>((done) => this.sftp.fstat(handle, done));
    let position = offset;
    return {
      size: stats.size,
      read: async (max) => {
        const buffer = Buffer.alloc(max);
        const read = await this.#call<number>((done) =>
          this.sftp.read(handle, buffer, 0, max, position, (err, bytesRead) =>
            done(err, bytesRead),
          ),
        );
        if (read === 0) return null;
        position += read;
        return new Uint8Array(buffer.subarray(0, read));
      },
      close: () => this.#call((done) => this.sftp.close(handle, done)),
    };
  }

  async openWrite(path: string, offset = 0): Promise<TransferSink> {
    // 새로 쓰기는 배타 생성(wx): 미리 심은 링크·같은 이름 파일에 쓰지 않는다(보안 리뷰 M1).
    // 이어 쓰기는 일반 파일일 때만 지우지 않고 열어(r+) 그 지점부터 쓴다(TR2)
    const current = await this.stat(path);
    if (offset === 0 && current) throw new SftpError('exists');
    if (offset > 0 && current?.type !== 'file') throw new SftpError('failure');
    const flags = offset > 0 ? 'r+' : 'wx';
    const handle = await this.#call<Buffer>((done) => this.sftp.open(path, flags, done));
    let position = offset;
    let open = true;
    const close = async () => {
      if (!open) return;
      open = false;
      await this.#call((done) => this.sftp.close(handle, done));
    };
    return {
      write: async (chunk) => {
        const buffer = Buffer.from(chunk);
        await this.#call((done) =>
          this.sftp.write(handle, buffer, 0, buffer.length, position, done),
        );
        position += buffer.length;
      },
      finish: close,
      keep: close,
      abort: async () => {
        await close().catch(() => undefined);
        await this.removeFile(path).catch(() => undefined);
      },
    };
  }

  close(): void {
    this.sftp.end();
  }
}
