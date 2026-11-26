// 패키징 결과(압축 해제본)의 실행 파일 경로. package-win·package-mac, check-fuses, smoke-packaged가 같이 쓴다.
import { posix, win32 } from 'node:path';

export function packagedExecutable(buildDir, platform = process.platform) {
  if (platform === 'win32') return win32.join(buildDir, 'win-unpacked', 'btterm.exe');
  // universal(Apple Silicon + Intel, 결정 M2) 빌드의 .app 번들 안 실행 파일
  if (platform === 'darwin')
    return posix.join(buildDir, 'mac-universal', 'btterm.app', 'Contents', 'MacOS', 'btterm');
  throw new Error(`패키징 대상이 아닌 OS: ${platform}`);
}
