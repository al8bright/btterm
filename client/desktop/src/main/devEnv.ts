import { APP_ORIGIN } from './appProtocol';

type Env = Record<string, string | undefined>;

// 개발·E2E 전용 환경 변수. 출시(패키징) 빌드는 따르지 않는다: 환경 변수만으로 원격 페이지를
// 신뢰된 renderer로 띄우거나 앱 데이터 폴더를 바꿀 수 없게 한다(보안 리뷰 2026-10-20 #2).

export function devRendererUrl(env: Env, packaged: boolean): string | null {
  return packaged ? null : (env.ELECTRON_RENDERER_URL ?? null);
}

export function userDataOverride(env: Env, packaged: boolean): string | null {
  return packaged ? null : (env.BTTERM_USER_DATA ?? null);
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** IPC 발신자 검증: app:// 또는 (개발 빌드) 개발 서버와 origin이 정확히 같을 때만 믿는다. */
export function isTrustedSender(frameUrl: string | undefined, devUrl: string | null): boolean {
  if (!frameUrl) return false;
  if (frameUrl.startsWith(`${APP_ORIGIN}/`)) return true;
  if (devUrl === null) return false;
  const origin = originOf(frameUrl);
  return origin !== null && origin !== 'null' && origin === originOf(devUrl);
}

// Chromium이 OS 키 저장소 대신 고정 키·평문 저장소를 쓰게 하는 스위치(SEC-2).
// 개발·스모크 실행에서만 의미가 있다. password-store는 Linux 전용이지만 같이 막는다.
const INSECURE_KEY_STORE_SWITCHES = ['use-mock-keychain', 'password-store'];

/** 출시 빌드가 이런 스위치로 실행됐으면 그 이름. main은 비밀 저장을 끈다(보안 리뷰 M-1) */
export function insecureKeyStoreSwitch(
  hasSwitch: (name: string) => boolean,
  packaged: boolean,
): string | null {
  if (!packaged) return null;
  return INSECURE_KEY_STORE_SWITCHES.find((name) => hasSwitch(name)) ?? null;
}
