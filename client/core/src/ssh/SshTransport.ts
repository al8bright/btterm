import type { SftpSession } from '../sftp/SftpSession';
import type { Disposable } from '../resource/ResourceTracker';

/** SSH 엔진 포트(D6). 도메인 코드는 ssh2 타입을 직접 쓰지 않는다. */
export interface SshTransport {
  connect(options: ConnectOptions, auth: AuthMethod[], hooks: AuthHooks): Promise<SshConnection>;
}

export interface ConnectOptions {
  host: string;
  port: number;
  username: string;
  keepaliveSec: number;
  readyTimeoutMs?: number;
}

/** 비밀 값은 session host 안에서만 존재한다(SEC-1). */
export type AuthMethod =
  | { kind: 'password'; password: string }
  | { kind: 'privateKey'; privateKey: Uint8Array; passphrase?: string | undefined }
  | { kind: 'agent'; agentPath: string };

export interface PresentedHostKey {
  keyType: string;
  /** base64(공개키 blob) — known_hosts 형식과 같다. */
  key: string;
  /** "SHA256:..." */
  fingerprint: string;
}

export interface KeyboardInteractiveRequest {
  name: string;
  instructions: string;
  prompts: Array<{ prompt: string; echo: boolean }>;
}

export interface AuthHooks {
  /** false를 돌려주면 인증 정보를 보내기 전에 연결을 끊는다(SEC-3). */
  verifyHostKey(key: PresentedHostKey): Promise<boolean>;
  /** 있으면 keyboard-interactive(OTP 등)를 시도한다. 답 배열은 prompts 순서와 같다(F2.1). */
  keyboardInteractive?(request: KeyboardInteractiveRequest): Promise<string[]>;
}

export interface PtySize {
  cols: number;
  rows: number;
}

declare const fixedCommand: unique symbol;
/**
 * exec로 실행해도 되는 고정 명령(보안 리뷰 #3). 원격·사용자 입력을 이어 붙인 문자열은 이 타입이 될 수 없다.
 * 만드는 곳은 core 상수(`STATS_SCRIPT`)뿐이다.
 */
export type FixedCommand = string & { readonly [fixedCommand]: true };

export interface SshConnection {
  openShell(size: PtySize): Promise<ByteDuplex>;
  onClose(listener: (error?: SshError) => void): Disposable;
  /** 연결이 살아 있는지 왕복으로 확인한다. timeoutMs 안에 응답이 없으면 false(F6.6). */
  probe(timeoutMs: number): Promise<boolean>;
  /** 홈 기준 경로 파일의 끝 maxBytes를 SFTP로 읽는다(F3.17a). */
  readFileTail(path: string, maxBytes: number): Promise<RemoteFileResult>;
  /** 같은 연결에 SFTP 채널을 하나 연다(F4.1). 닫는 책임은 호출자에게 있다. */
  openSftp(): Promise<SftpSession>;
  /**
   * 고정 명령을 exec 채널로 실행하고 표준 출력을 maxBytes까지 받는다(F3.18).
   * 실패·시간 초과·끝난 연결은 null. 명령에 원격·사용자 입력을 넣지 않는다.
   */
  execCapture(
    command: FixedCommand,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<Uint8Array | null>;
  end(): void;
}

export type RemoteFileResult =
  | { status: 'ok'; bytes: Uint8Array; truncated: boolean }
  | { status: 'missing' | 'denied' | 'unavailable' };

export interface ByteDuplex {
  write(data: Uint8Array | string): void;
  onData(listener: (chunk: Uint8Array) => void): Disposable;
  onClose(listener: () => void): Disposable;
  pause(): void;
  resume(): void;
  resize(size: PtySize): void;
  close(): void;
}

export type SshErrorCode =
  | 'host-key-rejected'
  | 'auth-failed'
  | 'bad-passphrase'
  | 'agent-unavailable'
  | 'dns'
  | 'refused'
  | 'timeout'
  | 'closed'
  | 'unknown';

/** 연결 오류. UI는 code로 메시지를 고른다(F6.5). message는 로그용이며 마스킹 후 기록한다. */
export class SshError extends Error {
  constructor(
    readonly code: SshErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'SshError';
  }
}
