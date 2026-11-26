export interface CwdReport {
  host: string;
  path: string;
}

const MAX_PAYLOAD_LENGTH = 4096;
const FILE_SCHEME = 'file://';
// eslint-disable-next-line no-control-regex -- 제어문자 검출이 목적이다
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * OSC 7 페이로드(ESC ] 7 ; 뒤 BEL/ST 앞 문자열)를 읽는다.
 * file 스킴, 절대 경로, 제어문자 없음, 4096자 이하만 받는다. (SEC-5)
 */
export function parseOsc7(payload: string): CwdReport | null {
  if (payload.length > MAX_PAYLOAD_LENGTH) return null;
  if (!payload.startsWith(FILE_SCHEME)) return null;
  const rest = payload.slice(FILE_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const path = decodePath(rest.slice(slash));
  if (path === null || CONTROL_CHARS.test(path)) return null;
  return { host: rest.slice(0, slash), path };
}

function decodePath(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** 세션별 OSC 7 수락 정책. 처음 받은 host를 원격 호스트로 기억하고 다른 host의 보고는 무시한다. (SEC-5) */
export class CwdTracker {
  private host: string | null = null;
  private cwd: string | null = null;

  get current(): string | null {
    return this.cwd;
  }

  get remoteHost(): string | null {
    return this.host;
  }

  accept(report: CwdReport): boolean {
    if (this.host === null) {
      this.host = report.host;
    } else if (!this.matchesRemote(report.host)) {
      return false;
    }
    this.cwd = report.path;
    return true;
  }

  reset(): void {
    this.host = null;
    this.cwd = null;
  }

  /** localhost·빈 host도 예외 없이 비교한다: 원격 출력(cat 등)에 섞인 위조 보고를 막는다(SEC-5). */
  private matchesRemote(host: string): boolean {
    return this.host !== null && host.toLowerCase() === this.host.toLowerCase();
  }
}
