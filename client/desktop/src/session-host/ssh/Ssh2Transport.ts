import ssh2 from 'ssh2';
import ssh2Constants from 'ssh2/lib/protocol/constants.js';
import type { ClientChannel, ConnectConfig, ServerHostKeyAlgorithm, SFTPWrapper } from 'ssh2';
import {
  preferKnownHostKeyAlgorithms,
  SshError,
  type AuthHooks,
  type AuthMethod,
  type ByteDuplex,
  type ConnectOptions,
  type Disposable,
  type PtySize,
  type RemoteFileResult,
  type SftpSession,
  type SshConnection,
  type SshErrorCode,
  type SshTransport,
  type FixedCommand,
} from '@btterm/core';
import { describeHostKey } from './hostKeyBlob';
import { inspectKey } from './keyInspector';
import { Ssh2Sftp } from './Ssh2Sftp';

const { Client } = ssh2;

export { describeHostKey };

/**
 * ssh2가 이 런타임에서 쓰는 호스트 키 알고리즘 기본 목록(lib/protocol/constants.js DEFAULT_SERVER_HOST_KEY).
 * 하드코딩하지 않고 실행 시점 값을 읽는다: ssh2는 런타임(Electron 포함)이 Ed25519를 지원할 때만 넣으므로,
 * 지원하지 않는 알고리즘을 넘겨 모든 접속이 실패하는 일이 없게 한다.
 */
export const SSH2_DEFAULT_SERVER_HOST_KEY: readonly ServerHostKeyAlgorithm[] =
  ssh2Constants.DEFAULT_SERVER_HOST_KEY as ServerHostKeyAlgorithm[];

/**
 * SEC-3: 이미 알려진 종류의 호스트 키를 서버가 먼저 고르게 한다. 알려진 키와 다른 종류는 차단하므로
 * 정상 서버가 오탐으로 막히지 않게 하는 장치다. 알려진 종류가 없으면 undefined(ssh2 기본값).
 */
export function serverHostKeyAlgorithms(
  knownKeyTypes: readonly string[] | undefined,
): ServerHostKeyAlgorithm[] | undefined {
  const ordered = preferKnownHostKeyAlgorithms(SSH2_DEFAULT_SERVER_HOST_KEY, knownKeyTypes ?? []);
  return ordered ? (ordered as ServerHostKeyAlgorithm[]) : undefined;
}

/** ssh2 기반 SshTransport(D6). session host(utilityProcess)에서만 import한다(AGENTS §3). */
export class Ssh2Transport implements SshTransport {
  connect(options: ConnectOptions, auth: AuthMethod[], hooks: AuthHooks): Promise<SshConnection> {
    // F6.5: 키 암호 문제는 네트워크에 가기 전에 분류한다(ssh2는 이 경우 동기 예외를 던진다).
    for (const method of auth) {
      if (method.kind !== 'privateKey') continue;
      const checked = inspectKey(method.privateKey, method.passphrase);
      if (!checked.ok) {
        return Promise.reject(
          new SshError(checked.reason === 'invalid' ? 'unknown' : 'bad-passphrase', checked.reason),
        );
      }
    }
    return new Promise((resolve, reject) => {
      const client = new Client();
      let hostKeyRejected = false;
      let settled = false;
      /** destroy: 응답 없는 상대에게 정상 종료 절차(end)를 밟지 않고 소켓을 바로 닫는다 */
      const fail = (error: Error & { level?: string; code?: string }, destroy = false) => {
        if (settled) return;
        settled = true;
        deadline.stop();
        if (destroy) client.destroy();
        else client.end();
        reject(
          new SshError(hostKeyRejected ? 'host-key-rejected' : classify(error), error.message),
        );
      };
      // 접속 제한 시간은 네트워크·서버를 기다리는 시간만 센다. 호스트 키·키보드 인증처럼
      // 사용자에게 묻는 동안은 멈춘다(지문을 천천히 비교하면 끊기던 문제, 2026-10-22 E2E 점검).
      const deadline = pausableDeadline(options.readyTimeoutMs ?? 20_000, () => {
        fail(Object.assign(new Error('접속 제한 시간 초과'), { level: 'client-timeout' }), true);
      });
      const asking = <T>(question: Promise<T>): Promise<T> => {
        deadline.stop();
        return question.finally(() => {
          if (!settled) deadline.start();
        });
      };

      const serverHostKey = serverHostKeyAlgorithms(options.knownHostKeyTypes);
      const config: ConnectConfig = {
        ...(serverHostKey ? { algorithms: { serverHostKey } } : {}),
        host: options.host,
        port: options.port,
        username: options.username,
        readyTimeout: 0, // ssh2 타이머 대신 위의 deadline을 쓴다
        keepaliveInterval: options.keepaliveSec * 1000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          asking(hooks.verifyHostKey(describeHostKey(key))).then(
            (ok) => {
              hostKeyRejected = !ok;
              verify(ok);
            },
            () => {
              hostKeyRejected = true;
              verify(false);
            },
          );
        },
        ...authConfig(auth),
        ...(hooks.keyboardInteractive ? { tryKeyboard: true } : {}),
      };

      if (hooks.keyboardInteractive) {
        const ask = hooks.keyboardInteractive;
        client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
          asking(
            ask({
              name,
              instructions,
              prompts: prompts.map((p) => ({ prompt: p.prompt, echo: p.echo === true })),
            }),
          ).then(finish, () => finish([]));
        });
      }

      client.once('ready', () => {
        settled = true;
        deadline.stop();
        resolve(new Ssh2Connection(client));
      });
      // ssh2는 한 번의 실패에 error를 여러 번 낼 수 있다(agent 오류 → 인증 실패). 계속 받아 무시한다.
      client.on('error', (error: Error) => fail(error));
      // 서버 헤더를 받은 뒤 끊기면 ssh2는 error 없이 close만 낸다. 남은 제한 시간을 기다리지 않는다.
      client.once('close', () =>
        fail(Object.assign(new Error('접속 중 연결이 끊김'), { code: 'ECONNRESET' })),
      );
      try {
        deadline.start();
        client.connect(config);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

/** 멈췄다 다시 시작할 수 있는 제한 시간. 다시 시작하면 남은 시간부터 센다. */
function pausableDeadline(ms: number, onExpire: () => void) {
  let remaining = ms;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    start() {
      if (timer) return;
      startedAt = Date.now();
      timer = setTimeout(onExpire, Math.max(remaining, 0));
    },
    stop() {
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
      remaining -= Date.now() - startedAt;
    },
  };
}

function authConfig(auth: AuthMethod[]): Partial<ConnectConfig> {
  const config: Partial<ConnectConfig> = {};
  for (const method of auth) {
    if (method.kind === 'password') config.password = method.password;
    if (method.kind === 'privateKey') {
      config.privateKey = Buffer.from(method.privateKey);
      if (method.passphrase !== undefined) config.passphrase = method.passphrase;
    }
    if (method.kind === 'agent') config.agent = method.agentPath;
  }
  return config;
}

function classify(error: Error & { level?: string; code?: string }): SshErrorCode {
  if (error.level === 'agent' || /agent/i.test(error.message)) return 'agent-unavailable';
  if (error.level === 'client-authentication') return 'auth-failed';
  if (error.level === 'client-timeout') return 'timeout';
  switch (error.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'dns';
    case 'ECONNREFUSED':
      return 'refused';
    case 'ETIMEDOUT':
      return 'timeout';
    case 'ECONNRESET':
      return 'closed';
    default:
      return 'unknown';
  }
}

class Ssh2Connection implements SshConnection {
  readonly #closeListeners = new Set<(error?: SshError) => void>();
  #lastError: SshError | undefined;
  #ending = false;

  constructor(private readonly client: InstanceType<typeof Client>) {
    client.on('error', (error: Error & { level?: string; code?: string }) => {
      this.#lastError = new SshError(classify(error), error.message);
    });
    client.once('close', () => {
      // 우리가 끝내지 않았는데 닫혔으면 끊김이다(AC12 자동 재접속 대상).
      const error =
        this.#lastError ?? (this.#ending ? undefined : new SshError('closed', '연결이 끊김'));
      for (const listener of [...this.#closeListeners]) listener(error);
    });
  }

  openShell(size: PtySize): Promise<ByteDuplex> {
    return new Promise((resolve, reject) => {
      this.client.shell(
        { term: 'xterm-256color', cols: size.cols, rows: size.rows },
        (err, stream) => {
          if (err) reject(new SshError('unknown', err.message));
          else resolve(new Ssh2Shell(stream));
        },
      );
    });
  }

  onClose(listener: (error?: SshError) => void): Disposable {
    this.#closeListeners.add(listener);
    return { dispose: () => this.#closeListeners.delete(listener) };
  }

  /** 가벼운 exec 채널 왕복으로 생존을 확인한다(F6.6). 끊긴 TCP는 응답이 없어 시간 초과로 판정된다. */
  probe(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const done = (alive: boolean) => {
        clearTimeout(timer);
        resolve(alive);
      };
      try {
        this.client.exec('true', (err, stream) => {
          if (err) return done(false);
          stream.on('error', () => done(false));
          stream.on('close', () => done(true));
          stream.resume();
        });
      } catch {
        done(false);
      }
    });
  }

  openSftp(): Promise<SftpSession> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) =>
        err ? reject(new SshError('unknown', err.message)) : resolve(new Ssh2Sftp(sftp)),
      );
    });
  }

  /** 고정 명령의 표준 출력만 받는다(F3.18). 상한을 넘으면 채널을 닫고 받은 만큼만 돌려준다. */
  execCapture(
    command: FixedCommand,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<Uint8Array | null> {
    if (this.#ending) return Promise.resolve(null);
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      let channel: ClientChannel | null = null;
      const finish = (result: Uint8Array | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        channel?.close();
        resolve(result);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        this.client.exec(command, (err, stream) => {
          if (err) return finish(null);
          // 시간 초과 뒤에 늦게 열린 채널은 바로 닫는다(채널 누적 방지, 보안 리뷰 #1).
          if (settled) return void stream.close();
          channel = stream;
          stream.on('error', () => finish(null));
          stream.stderr.resume();
          stream.on('data', (chunk: Buffer) => {
            const room = maxBytes - size;
            if (room > 0) {
              const part = chunk.subarray(0, room);
              chunks.push(part);
              size += part.length;
            }
            if (size >= maxBytes) finish(new Uint8Array(Buffer.concat(chunks)));
          });
          stream.on('close', () => finish(new Uint8Array(Buffer.concat(chunks))));
        });
      } catch {
        finish(null);
      }
    });
  }

  readFileTail(path: string, maxBytes: number): Promise<RemoteFileResult> {
    return new Promise((resolve) => {
      this.client.sftp((err, sftp) => {
        if (err) return resolve({ status: 'unavailable' });
        const done = (result: RemoteFileResult) => {
          sftp.end();
          resolve(result);
        };
        sftp.open(path, 'r', (openErr, handle) => {
          if (openErr) return done({ status: sftpStatus(openErr) });
          readTail(sftp, handle, maxBytes).then(
            (result) => sftp.close(handle, () => done(result)),
            () => sftp.close(handle, () => done({ status: 'unavailable' })),
          );
        });
      });
    });
  }

  end(): void {
    this.#ending = true;
    this.client.end();
  }
}

const SFTP_NO_SUCH_FILE = 2;
const SFTP_PERMISSION_DENIED = 3;

function sftpStatus(error: Error & { code?: unknown }): 'missing' | 'denied' | 'unavailable' {
  if (error.code === SFTP_NO_SUCH_FILE) return 'missing';
  if (error.code === SFTP_PERMISSION_DENIED) return 'denied';
  return 'unavailable';
}

/** 열린 파일의 끝 maxBytes를 읽는다. */
function readTail(
  sftp: SFTPWrapper,
  handle: Buffer,
  maxBytes: number,
): Promise<Extract<RemoteFileResult, { status: 'ok' }>> {
  return new Promise((resolve, reject) => {
    sftp.fstat(handle, (statErr, stats) => {
      if (statErr) return reject(statErr);
      const start = Math.max(0, stats.size - maxBytes);
      const buffer = Buffer.alloc(stats.size - start);
      const step = (offset: number): void => {
        if (offset >= buffer.length) {
          resolve({ status: 'ok', bytes: new Uint8Array(buffer), truncated: start > 0 });
          return;
        }
        sftp.read(handle, buffer, offset, buffer.length - offset, start + offset, (err, read) => {
          if (err) return reject(err);
          if (read === 0) {
            resolve({
              status: 'ok',
              bytes: new Uint8Array(buffer.subarray(0, offset)),
              truncated: start > 0,
            });
            return;
          }
          step(offset + read);
        });
      };
      step(0);
    });
  });
}

class Ssh2Shell implements ByteDuplex {
  constructor(private readonly stream: ClientChannel) {}

  write(data: Uint8Array | string): void {
    this.stream.write(typeof data === 'string' ? data : Buffer.from(data));
  }

  onData(listener: (chunk: Uint8Array) => void): Disposable {
    const handler = (chunk: Buffer) => listener(new Uint8Array(chunk));
    this.stream.on('data', handler);
    return { dispose: () => this.stream.off('data', handler) };
  }

  onClose(listener: () => void): Disposable {
    this.stream.on('close', listener);
    return { dispose: () => this.stream.off('close', listener) };
  }

  pause(): void {
    this.stream.pause();
  }

  resume(): void {
    this.stream.resume();
  }

  resize(size: PtySize): void {
    this.stream.setWindow(size.rows, size.cols, 0, 0);
  }

  close(): void {
    this.stream.end();
  }
}
