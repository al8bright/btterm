import type { TransferSink, TransferSource } from './TransferQueue';

export interface RemoteEntry {
  name: string;
  type: 'file' | 'dir' | 'link' | 'other';
  size: number;
  mtimeMs: number;
  /** 권한 비트(0o7777) */
  mode: number;
}

export type SftpErrorCode = 'missing' | 'denied' | 'exists' | 'not-empty' | 'failure';

/** SFTP 오류. UI는 code로 메시지를 고른다. message는 로그용. */
export class SftpError extends Error {
  constructor(
    readonly code: SftpErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SftpError';
  }
}

/**
 * 원격 파일 작업 포트(F4.1, F4.2). 경로는 POSIX 절대 경로 또는 홈 기준 상대 경로.
 * 실제 구현은 session host의 ssh2 어댑터, 테스트는 FakeSftp.
 */
export interface SftpSession {
  realpath(path: string): Promise<string>;
  /** 이름순, '.'·'..' 제외 */
  list(path: string): Promise<RemoteEntry[]>;
  stat(path: string): Promise<RemoteEntry | null>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  /** 빈 폴더만 */
  removeDir(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** 작은 파일(rc 등) 전체 읽기. 없으면 SftpError('missing') */
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** 끝에 덧붙인다. 없으면 mode로 만들고, 있으면 권한을 그대로 둔다(TR5 authorized_keys) */
  appendFile(path: string, data: Uint8Array, mode: number): Promise<void>;
  /**
   * 임시 파일에 쓴 뒤 바꿔 넣는다. 쓰는 중 끊겨도 원본이 잘린 채 남지 않는다(rc 파일 등).
   * 심볼릭 링크면 링크가 가리키는 파일을 바꾼다.
   */
  writeFileAtomic(path: string, data: Uint8Array): Promise<void>;
  /** offset: 이어받기 시작 지점(TR2) */
  openRead(path: string, offset?: number): Promise<TransferSource>;
  /** 쓰기. offset > 0이면 그 지점부터 잇는다. abort는 부분 파일을 지우고 keep은 남긴다 */
  openWrite(path: string, offset?: number): Promise<TransferSink>;
  /** from을 to 자리로 바꿔 넣는다(있으면 덮어씀, posix-rename) */
  replace(from: string, to: string): Promise<void>;
  close(): void;
}

/** POSIX 경로 이어 붙이기(원격 경로는 항상 '/') */
export function joinRemote(dir: string, name: string): string {
  if (dir === '' || dir === '.') return name;
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export function parentRemote(path: string): string {
  if (path === '/' || path === '') return '/';
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  return index <= 0 ? '/' : trimmed.slice(0, index);
}

export function baseRemote(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}
