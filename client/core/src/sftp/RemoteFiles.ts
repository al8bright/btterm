import type { HostFilesOp } from '../ipc/contracts';
import { addAuthorizedKey, isPublicKeyLine } from './authorizedKeys';
import { joinRemote, SftpError, type RemoteEntry, type SftpSession } from './SftpSession';
import {
  addRcBlock,
  hasRcBlock,
  LOGIN_FILES,
  RC_FILES,
  removeRcBlock,
  SHELL_SCRIPT,
  SHELL_SCRIPT_PATH,
  sourcesBashrc,
} from './shellIntegration';

export interface Listing {
  path: string;
  entries: RemoteEntry[];
}

export interface ShellIntegrationStatus {
  installed: boolean;
  /** 블록이 들어 있는 rc·로그인 파일 */
  rcFiles: string[];
  /** bash 로그인 셸에서도 통합이 읽히는지. 로그인 파일이 없으면 null */
  loginCovered: boolean | null;
}

const BACKUP_SUFFIX = '.btterm-backup';
const SSH_DIR = '.ssh';
const AUTHORIZED_KEYS = '.ssh/authorized_keys';
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * 세션 하나의 원격 파일 작업(F4.1, F4.2)과 셸 통합 설치(F4.5). SFTP 채널은 처음 쓸 때 연다.
 * 전송은 별도 채널을 쓴다(F4.4).
 */
export class RemoteFiles {
  #session: Promise<SftpSession> | null = null;
  #opened: SftpSession | null = null;

  constructor(private readonly open: () => Promise<SftpSession>) {}

  session(): Promise<SftpSession> {
    this.#session ??= this.open().then(
      (sftp) => (this.#opened = sftp),
      (error: unknown) => {
        this.#session = null;
        throw error;
      },
    );
    return this.#session;
  }

  /** IPC로 받은 파일 작업 하나를 실행한다. */
  async run(op: HostFilesOp): Promise<unknown> {
    switch (op.kind) {
      case 'list':
        return this.list(op.path);
      case 'mkdir':
        return (await this.session()).mkdir(op.path);
      case 'rename':
        return (await this.session()).rename(op.from, op.to);
      case 'remove':
        return this.remove(op.path);
      case 'chmod':
        return (await this.session()).chmod(op.path, op.mode);
      case 'shellStatus':
        return this.shellIntegrationStatus();
      case 'shellInstall':
        return this.installShellIntegration();
      case 'shellUninstall':
        return this.uninstallShellIntegration();
      case 'installKey':
        return this.installPublicKey(op.publicKey);
    }
  }

  async list(path: string): Promise<Listing> {
    const sftp = await this.session();
    const resolved = await sftp.realpath(path);
    const entries = await sftp.list(resolved);
    return { path: resolved, entries: entries.sort(dirsFirst) };
  }

  /** 파일은 바로, 폴더는 내용째 지운다(UI에서 확인 후 호출). */
  async remove(path: string): Promise<void> {
    const sftp = await this.session();
    const entry = await sftp.stat(path);
    if (!entry) throw new SftpError('missing');
    if (entry.type !== 'dir') {
      await sftp.removeFile(path);
      return;
    }
    for (const child of await sftp.list(path)) await this.remove(joinRemote(path, child.name));
    await sftp.removeDir(path);
  }

  async shellIntegrationStatus(): Promise<ShellIntegrationStatus> {
    const sftp = await this.session();
    const rcFiles: string[] = [];
    for (const file of [...RC_FILES, ...LOGIN_FILES]) {
      const text = await readText(sftp, file);
      if (text !== null && hasRcBlock(text)) rcFiles.push(file);
    }
    const script = await sftp.stat(SHELL_SCRIPT_PATH);
    const login = await this.#loginFile(sftp);
    return {
      installed: rcFiles.length > 0 && script !== null,
      rcFiles,
      loginCovered:
        login === null
          ? null
          : rcFiles.includes(login.name) ||
            (sourcesBashrc(login.text) && rcFiles.includes('.bashrc')),
    };
  }

  /**
   * 동의 후 설치: shell.sh 작성, rc에 마커 블록(처음 한 번 백업). 여러 번 해도 같다.
   * SSH 로그인 셸은 .bashrc를 읽지 않으므로, bash가 읽을 로그인 파일이 .bashrc를 읽지 않으면
   * 그 파일에도 넣고, 로그인 파일이 없으면 .bash_profile을 만든다.
   */
  async installShellIntegration(): Promise<ShellIntegrationStatus> {
    const sftp = await this.session();
    // 먼저 모두 읽어 이상한 파일(너무 큼 등)이 있으면 아무것도 바꾸지 않는다.
    const rcTexts = new Map<string, string>();
    for (const rc of RC_FILES) {
      const text = await readText(sftp, rc);
      if (text !== null) rcTexts.set(rc, text);
    }
    if (rcTexts.size === 0) rcTexts.set('.bashrc', '');
    const login = await this.#loginFile(sftp);
    if (login === null) rcTexts.set('.bash_profile', '');
    else if (!sourcesBashrc(login.text)) rcTexts.set(login.name, login.text);

    await mkdirs(sftp, '.config/btterm');
    await sftp.writeFileAtomic(SHELL_SCRIPT_PATH, enc(SHELL_SCRIPT));
    for (const [file, text] of rcTexts) await rewrite(sftp, file, text, addRcBlock(text));
    return this.shellIntegrationStatus();
  }

  async uninstallShellIntegration(): Promise<ShellIntegrationStatus> {
    const sftp = await this.session();
    for (const rc of [...RC_FILES, ...LOGIN_FILES]) {
      const text = await readText(sftp, rc);
      if (text !== null) await rewrite(sftp, rc, text, removeRcBlock(text));
    }
    if (await sftp.stat(SHELL_SCRIPT_PATH)) await sftp.removeFile(SHELL_SCRIPT_PATH);
    return this.shellIntegrationStatus();
  }

  /**
   * F7.8: 공개키를 ~/.ssh/authorized_keys에 없을 때만 덧붙인다. 폴더 700, 파일 600(sshd StrictModes).
   * 줄 형식이 아니거나 .ssh가 폴더가 아니면 아무것도 바꾸지 않는다.
   */
  async installPublicKey(publicKey: string): Promise<{ added: boolean }> {
    if (!isPublicKeyLine(publicKey)) throw new SftpError('failure', '공개키 형식이 아님');
    const sftp = await this.session();
    const dir = await sftp.stat(SSH_DIR);
    if (dir === null) {
      await sftp.mkdir(SSH_DIR);
      await sftp.chmod(SSH_DIR, 0o700);
    } else if (dir.type !== 'dir') {
      throw new SftpError('failure', `${SSH_DIR}: 폴더가 아님`);
    }
    const existing = await sftp.stat(AUTHORIZED_KEYS);
    // 링크는 따라가지 않는다(.ssh와 같은 규칙). 쓰기 금지는 관리자가 잠근 것이니 두다(보안 리뷰 L2·L3)
    if (existing && existing.type !== 'file') {
      throw new SftpError('failure', `${AUTHORIZED_KEYS}: 일반 파일이 아님`);
    }
    if (existing && (existing.mode & 0o200) === 0) throw new SftpError('denied');
    const before = (await readText(sftp, AUTHORIZED_KEYS)) ?? '';
    const edit = addAuthorizedKey(before, publicKey);
    if (!edit.changed) return { added: false };
    // 바꿔 넣지 않고 덧붙인다: 동시 편집을 덮지 않고, 실패해도 기존 키가 사라지지 않는다(M1·M2)
    await sftp.appendFile(AUTHORIZED_KEYS, enc(edit.text.slice(before.length)), 0o600);
    if (!existing) await sftp.chmod(AUTHORIZED_KEYS, 0o600);
    return { added: true };
  }

  close(): void {
    const pending = this.#session;
    const opened = this.#opened;
    this.#session = null;
    this.#opened = null;
    if (opened) opened.close();
    else
      void pending?.then(
        (s) => s.close(),
        () => undefined,
      );
  }

  /** bash 로그인 셸이 읽는 파일: 이 순서로 처음 찾은 하나만 읽는다. */
  async #loginFile(sftp: SftpSession): Promise<{ name: string; text: string } | null> {
    for (const name of LOGIN_FILES) {
      const text = await readText(sftp, name);
      if (text !== null) return { name, text };
    }
    return null;
  }
}

/**
 * 바뀌는 파일만 다시 쓴다. 바꾸기 직전 내용을 백업하고(설치·제거 모두), 원자적으로 교체해
 * 쓰는 중 끊겨도 rc가 잘린 채 남지 않게 한다(보안 리뷰 #3).
 */
async function rewrite(
  sftp: SftpSession,
  file: string,
  before: string,
  edit: { text: string; changed: boolean },
): Promise<void> {
  if (!edit.changed) return;
  if (before !== '') {
    // 백업은 원본(링크면 대상)과 같은 권한으로 처음부터 배타 생성한다: 600 rc에 든 토큰이
    // 기본 권한(644) 백업으로 새지 않게(F4.5). 지난 백업은 이름만 지운다(링크면 링크만)
    const backup = file + BACKUP_SUFFIX;
    const mode = (await permissionBits(sftp, file)) ?? PRIVATE_FILE_MODE;
    if (await sftp.stat(backup)) await sftp.removeFile(backup);
    await sftp.createFile(backup, enc(before), mode);
  }
  await sftp.writeFileAtomic(file, enc(edit.text));
}

const PRIVATE_FILE_MODE = 0o600;

/** 파일(링크면 가리키는 파일)의 권한 비트(0o777). 없으면 null */
async function permissionBits(sftp: SftpSession, path: string): Promise<number | null> {
  const entry = await sftp.stat(path);
  const info = entry?.type === 'link' ? await sftp.stat(await sftp.realpath(path)) : entry;
  return info ? info.mode & 0o777 : null;
}

/** rc 같은 설정 파일 상한. 이보다 크면 정상적인 rc가 아니다(/dev/zero 링크 등, 보안 리뷰 #5). */
const MAX_TEXT_BYTES = 1024 * 1024;

async function readText(sftp: SftpSession, path: string): Promise<string | null> {
  const entry = await sftp.stat(path);
  if (!entry) return null;
  const info = entry.type === 'link' ? await sftp.stat(await sftp.realpath(path)) : entry;
  if (!info) return null;
  if (info.type !== 'file' || info.size > MAX_TEXT_BYTES) {
    throw new SftpError('failure', `${path}: 일반 텍스트 파일이 아니거나 너무 큼`);
  }
  try {
    return dec(await sftp.readFile(path));
  } catch (error) {
    if (error instanceof SftpError && error.code === 'missing') return null;
    throw error;
  }
}

async function mkdirs(sftp: SftpSession, path: string): Promise<void> {
  let current = '';
  for (const part of path.split('/')) {
    current = current ? `${current}/${part}` : part;
    if ((await sftp.stat(current)) === null) await sftp.mkdir(current);
  }
}

function dirsFirst(a: RemoteEntry, b: RemoteEntry): number {
  const rank = (e: RemoteEntry) => (e.type === 'dir' ? 0 : 1);
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}
