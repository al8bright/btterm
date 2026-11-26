import { describe, expect, it } from 'vitest';
import {
  devRendererUrl,
  insecureKeyStoreSwitch,
  isTrustedSender,
  userDataOverride,
} from './devEnv';

describe('개발용 환경 변수(보안 리뷰 #2)', () => {
  const env = {
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
    BTTERM_USER_DATA: 'C:/tmp/e2e',
  };

  it('출시(패키징) 빌드는 렌더러 URL·userData 환경 변수를 무시한다', () => {
    expect(devRendererUrl(env, true)).toBeNull();
    expect(userDataOverride(env, true)).toBeNull();
  });

  it('개발·E2E 빌드에서만 따른다', () => {
    expect(devRendererUrl(env, false)).toBe('http://localhost:5173');
    expect(userDataOverride(env, false)).toBe('C:/tmp/e2e');
    expect(devRendererUrl({}, false)).toBeNull();
  });
});

describe('isTrustedSender', () => {
  it('app:// 출처만 믿는다', () => {
    expect(isTrustedSender('app://btterm/index.html', null)).toBe(true);
    expect(isTrustedSender('app://evil/index.html', null)).toBe(false);
    expect(isTrustedSender('https://example.com/', null)).toBe(false);
    expect(isTrustedSender(undefined, null)).toBe(false);
  });

  it('개발 서버는 origin이 정확히 같을 때만(접두사 일치 금지)', () => {
    const dev = 'http://localhost:5173';
    expect(isTrustedSender('http://localhost:5173/index.html', dev)).toBe(true);
    expect(isTrustedSender('http://localhost:5173.evil.com/x', dev)).toBe(false);
    expect(isTrustedSender('http://localhost:51730/x', dev)).toBe(false);
  });
});

describe('SEC-2 고정 키 저장소 스위치(보안 리뷰 M-1)', () => {
  const has =
    (...names: string[]) =>
    (name: string) =>
      names.includes(name);

  it('출시 빌드가 모의 키체인·평문 저장소 스위치를 받으면 그 이름을 돌려준다(비밀 저장을 끈다)', () => {
    expect(insecureKeyStoreSwitch(has('use-mock-keychain'), true)).toBe('use-mock-keychain');
    expect(insecureKeyStoreSwitch(has('password-store'), true)).toBe('password-store');
  });

  it('스위치가 없거나 개발 빌드면 null', () => {
    expect(insecureKeyStoreSwitch(has(), true)).toBeNull();
    expect(insecureKeyStoreSwitch(has('use-mock-keychain'), false)).toBeNull();
  });
});
