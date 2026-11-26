import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import type { KeymapPlatform } from '@btterm/core';

// OS 의존 경로는 이 모듈에서만 계산한다(AGENTS §3).

/** Windows 내장 OpenSSH agent의 named pipe(F2.2). macOS는 M2에서 SSH_AUTH_SOCK. */
export function windowsOpenSshAgentPath(): string {
  return '\\\\.\\pipe\\openssh-ssh-agent';
}

/** 현재 OS의 SSH agent 경로. 없으면 null. */
export function sshAgentPath(): string | null {
  if (process.platform === 'win32') return windowsOpenSshAgentPath();
  return process.env.SSH_AUTH_SOCK ?? null;
}

/** "~/" 로 시작하는 경로를 홈 기준 절대 경로로 바꾼다(ssh_config IdentityFile 등). */
export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') || path.startsWith('~\\')
    ? join(homedir(), path.slice(2))
    : path;
}

/**
 * Windows 네트워크·장치 경로(`\\host\share`, `\\?\`, `\\.\`, `//host`). 동기화로 받은 키 경로가
 * 이런 값이면 읽는 순간 NTLM 인증이 다른 호스트로 나갈 수 있어 읽지 않는다(보안 리뷰 S-2 L4).
 */
export function isWindowsNetworkPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && /^[\\/]{2}/.test(path);
}

/** 키 내보내기 저장 대화상자의 기본 위치(F7.7). 사용자 홈의 개인 폴더 아래 */
export function defaultKeyExportPath(): string {
  return join(homedir(), 'id_btterm');
}

/** 사용자 OpenSSH known_hosts(읽기 전용으로만 쓴다). */
export function userKnownHostsPath(): string {
  return join(homedir(), '.ssh', 'known_hosts');
}

/** 허용 목록 밖 파일을 실행 없이 여는 텍스트 편집기(F4.8). 파일 경로는 args 뒤에 붙인다 */
export function plainTextEditor(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env.SystemRoot,
): { command: string; args: string[] } | null {
  if (platform === 'win32') {
    return {
      command: win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe'),
      args: [],
    };
  }
  // -e: 파일 형식과 무관하게 TextEdit로 연다(기본 앱 실행을 피한다)
  if (platform === 'darwin') return { command: '/usr/bin/open', args: ['-e'] };
  return null;
}

/** renderer 키맵·창 크롬용 OS 플래그(D12). macOS 외에는 Windows 규칙을 쓴다 */
export function uiPlatform(): KeymapPlatform {
  return process.platform === 'darwin' ? 'mac' : 'windows';
}

/** 로컬 파일명 규칙(SEC-11) 판단용 플랫폼 */
export function localPlatform(): 'windows' | 'posix' {
  return process.platform === 'win32' ? 'windows' : 'posix';
}
