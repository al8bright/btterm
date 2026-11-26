import type { Disposable } from '../resource/ResourceTracker';
import {
  SshError,
  type AuthHooks,
  type AuthMethod,
  type ByteDuplex,
  type ConnectOptions,
  type FixedCommand,
  type PresentedHostKey,
  type PtySize,
  type RemoteFileResult,
  type SshConnection,
  type SshErrorCode,
  type SshTransport,
} from '../ssh/SshTransport';
import type { SftpSession } from '../sftp/SftpSession';
import { FakeRemoteFs, FakeSftp } from './FakeSftp';

export interface FakeSshOptions {
  users: Record<string, string>;
  /** 설정하면 hooks.keyboardInteractive로 이 프롬프트를 묻고 answer와 같으면 인증 성공 */
  keyboardInteractive?: { prompt: string; answer: string };
  /** 서버가 가진 호스트 키(서버 선호 순서). 클라이언트가 알려진 종류를 넘기면 그 종류를 먼저 고른다 */
  hostKeys?: PresentedHostKey[];
  /** SFTP로 읽을 홈 기준 파일. 'denied'면 권한 없음 */
  files?: Record<string, string | Uint8Array | 'denied'>;
  /** exec 명령의 출력. 없으면 `echo`만 해석한다. null이면 실패 */
  exec?: (command: string) => string | null;
}

const DEFAULT_HOST_KEY: PresentedHostKey = {
  keyType: 'ssh-ed25519',
  key: 'AAAAFAKEKEY',
  fingerprint: 'SHA256:fake',
};

type Listener<T> = (value: T) => void;

class Emitter<T> {
  #listeners = new Set<Listener<T>>();
  on(listener: Listener<T>): Disposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }
  emit(value: T): void {
    for (const listener of [...this.#listeners]) listener(value);
  }
}

/**
 * 스크립트로 제어하는 가짜 SSH 엔진. 실제 서버로 재현하기 어려운 인증 실패·끊김·백프레셔를
 * 결정적으로 만든다. 셸은 입력을 그대로 되돌려 주고 `echo` 명령만 해석한다.
 */
export class FakeSshTransport implements SshTransport {
  authAttempts = 0;
  lastPtySize: PtySize | null = null;
  /** SFTP로 보이는 원격 파일 시스템(홈 /home/user) */
  readonly remoteFs = new FakeRemoteFs('/home/user');
  readonly openedSftp: FakeSftp[] = [];
  /** 실행된 exec 명령 */
  readonly execCommands: string[] = [];
  /** 마지막 connect에 넘긴 옵션 */
  lastConnectOptions: ConnectOptions | null = null;
  readonly #options: FakeSshOptions;
  #nextFailure: SshErrorCode | null = null;
  readonly #connections = new Set<FakeConnection>();

  constructor(options: FakeSshOptions) {
    this.#options = options;
  }

  failNextConnect(code: SshErrorCode): void {
    this.#nextFailure = code;
  }

  /** 연결은 열려 있지만 응답하지 않는 상태(절전 후 끊긴 TCP 등). probe가 false를 돌려준다. */
  freezeConnection(): void {
    for (const conn of this.#connections) conn.frozen = true;
  }

  dropConnection(): void {
    for (const conn of [...this.#connections]) conn.terminate(new SshError('closed'));
  }

  /** 끝나지 않은 연결 수 */
  get openConnections(): number {
    return this.#connections.size;
  }

  emitShellOutput(text: string): void {
    for (const conn of this.#connections) conn.shell?.emitOutput(text);
  }

  async connect(
    options: ConnectOptions,
    auth: AuthMethod[],
    hooks: AuthHooks,
  ): Promise<SshConnection> {
    this.lastConnectOptions = options;
    if (this.#nextFailure) {
      const code = this.#nextFailure;
      this.#nextFailure = null;
      throw new SshError(code);
    }
    const serverKeys = this.#options.hostKeys ?? [DEFAULT_HOST_KEY];
    const known = options.knownHostKeyTypes ?? [];
    const hostKey = serverKeys.find((k) => known.includes(k.keyType)) ?? serverKeys[0]!;
    if (!(await hooks.verifyHostKey(hostKey))) throw new SshError('host-key-rejected');

    const expected = this.#options.users[options.username];
    let ok = auth.some((method) => {
      this.authAttempts += 1;
      return method.kind === 'password' && expected !== undefined && method.password === expected;
    });
    const kbd = this.#options.keyboardInteractive;
    if (!ok && kbd && hooks.keyboardInteractive) {
      this.authAttempts += 1;
      const answers = await hooks.keyboardInteractive({
        name: '',
        instructions: '',
        prompts: [{ prompt: kbd.prompt, echo: false }],
      });
      ok = answers[0] === kbd.answer;
    }
    if (!ok) throw new SshError('auth-failed');

    const conn = new FakeConnection(this, this.#options, () => this.#connections.delete(conn));
    this.#connections.add(conn);
    return conn;
  }
}

class FakeConnection implements SshConnection {
  shell: FakeShell | null = null;
  frozen = false;
  readonly #closed = new Emitter<SshError | undefined>();
  #ended = false;

  constructor(
    private readonly transport: FakeSshTransport,
    private readonly options: FakeSshOptions,
    private readonly onEnd: () => void,
  ) {}

  async openSftp(): Promise<SftpSession> {
    if (this.#ended) throw new Error('연결이 끝났습니다');
    const sftp = new FakeSftp(this.transport.remoteFs);
    this.transport.openedSftp.push(sftp);
    return sftp;
  }

  async readFileTail(path: string, maxBytes: number): Promise<RemoteFileResult> {
    if (this.#ended) return { status: 'unavailable' };
    const file = this.options.files?.[path];
    if (file === undefined) return { status: 'missing' };
    if (file === 'denied') return { status: 'denied' };
    const bytes = typeof file === 'string' ? new TextEncoder().encode(file) : file;
    const start = Math.max(0, bytes.length - maxBytes);
    return { status: 'ok', bytes: bytes.slice(start), truncated: start > 0 };
  }

  async execCapture(command: FixedCommand, maxBytes: number): Promise<Uint8Array | null> {
    if (this.#ended || this.frozen) return null;
    this.transport.execCommands.push(command);
    const output = this.options.exec ? this.options.exec(command) : fakeEcho(command);
    if (output === null) return null;
    return new TextEncoder().encode(output).slice(0, maxBytes);
  }

  async openShell(size: PtySize): Promise<ByteDuplex> {
    this.transport.lastPtySize = size;
    this.shell = new FakeShell((s) => (this.transport.lastPtySize = s));
    return this.shell;
  }

  onClose(listener: (error?: SshError) => void): Disposable {
    return this.#closed.on(listener);
  }

  async probe(): Promise<boolean> {
    return !this.#ended && !this.frozen;
  }

  end(): void {
    this.terminate(undefined);
  }

  terminate(error: SshError | undefined): void {
    if (this.#ended) return;
    this.#ended = true;
    this.shell?.close();
    this.onEnd();
    this.#closed.emit(error);
  }
}

class FakeShell implements ByteDuplex {
  readonly #data = new Emitter<Uint8Array>();
  readonly #closed = new Emitter<void>();
  readonly #encoder = new TextEncoder();
  #paused = false;
  #buffered: Uint8Array[] = [];
  #line = '';
  #open = true;

  constructor(private readonly onResize: (size: PtySize) => void) {}

  write(data: Uint8Array | string): void {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    for (const ch of text) {
      if (ch === '\n' || ch === '\r') {
        this.emitOutput('\r\n');
        this.#run(this.#line);
        this.#line = '';
      } else {
        this.#line += ch;
        this.emitOutput(ch);
      }
    }
  }

  emitOutput(text: string): void {
    if (!this.#open) return;
    const chunk = this.#encoder.encode(text);
    if (this.#paused) this.#buffered.push(chunk);
    else this.#data.emit(chunk);
  }

  onData(listener: (chunk: Uint8Array) => void): Disposable {
    return this.#data.on(listener);
  }

  onClose(listener: () => void): Disposable {
    return this.#closed.on(listener);
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    for (const chunk of this.#buffered.splice(0)) this.#data.emit(chunk);
  }

  resize(size: PtySize): void {
    this.onResize(size);
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#closed.emit();
  }

  #run(line: string): void {
    const output = fakeEcho(line);
    if (output !== null) this.emitOutput(`${output.replace(/\n$/, '')}\r\n$ `);
  }
}

/** `echo`와 `$((a+b))`만 해석한다. 다른 명령은 null. */
function fakeEcho(line: string): string | null {
  const echo = /^echo (.*)$/.exec(line.trim());
  if (!echo) return null;
  const expanded = echo[1]!.replace(/\$\(\((\d+)\+(\d+)\)\)/g, (_, a: string, b: string) =>
    String(Number(a) + Number(b)),
  );
  return `${expanded}\n`;
}
