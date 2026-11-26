import type { KeymapPlatform } from '../keymap/keymap';

// main이 webPreferences.additionalArguments로 넘기고 preload가 process.argv에서 읽는다(D12).
const PREFIX = '--btterm-platform=';

export function platformArg(platform: KeymapPlatform): string {
  return `${PREFIX}${platform}`;
}

/** 모르는 값이면 windows(기존 동작) */
export function parsePlatformArg(argv: readonly string[]): KeymapPlatform {
  const value = argv.find((arg) => arg.startsWith(PREFIX))?.slice(PREFIX.length);
  return value === 'mac' ? 'mac' : 'windows';
}
