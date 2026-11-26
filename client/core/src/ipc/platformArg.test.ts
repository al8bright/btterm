import { describe, expect, it } from 'vitest';
import { parsePlatformArg, platformArg } from './platformArg';

describe('preload OS 플래그 인자 (D12)', () => {
  it('main이 만든 인자를 preload가 그대로 읽는다', () => {
    expect(parsePlatformArg(['electron', platformArg('mac')])).toBe('mac');
    expect(parsePlatformArg(['electron', platformArg('windows')])).toBe('windows');
  });

  it('인자가 없거나 모르는 값이면 windows', () => {
    expect(parsePlatformArg(['electron'])).toBe('windows');
    expect(parsePlatformArg(['--btterm-platform=linux'])).toBe('windows');
  });
});
