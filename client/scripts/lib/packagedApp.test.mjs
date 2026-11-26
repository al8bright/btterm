import { describe, expect, it } from 'vitest';
import { packagedExecutable } from './packagedApp.mjs';

describe('패키징 실행 파일 경로 (Fuses·스모크, 2-D)', () => {
  it('Windows는 win-unpacked/btterm.exe', () => {
    expect(packagedExecutable('/b', 'win32').replaceAll('\\', '/')).toBe(
      '/b/win-unpacked/btterm.exe',
    );
  });

  it('macOS universal은 mac-universal/btterm.app 안의 실행 파일', () => {
    expect(packagedExecutable('/b', 'darwin')).toBe(
      '/b/mac-universal/btterm.app/Contents/MacOS/btterm',
    );
  });

  it('그 밖의 OS는 패키징 대상이 아니다', () => {
    expect(() => packagedExecutable('/b', 'linux')).toThrow();
  });
});
