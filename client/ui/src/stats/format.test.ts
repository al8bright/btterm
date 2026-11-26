import { describe, expect, it } from 'vitest';
import { formatBytes, formatRate, formatUptime } from './format';

describe('서버 상태 값 형식 (F3.18, DESIGN §5.4c)', () => {
  it('바이트는 1024 단위로 소수 한 자리(10 이상은 정수)', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB');
    expect(formatBytes(52 * 1024 ** 3)).toBe('52 GB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB');
  });

  it('속도는 /s를 붙인다', () => {
    expect(formatRate(12 * 1024)).toBe('12 KB/s');
    expect(formatRate(0)).toBe('0 B/s');
  });

  it('가동 시간: 하루 넘으면 일·시간, 아니면 시간·분, 한 시간 미만은 분', () => {
    expect(formatUptime(3 * 86400 + 4 * 3600 + 59)).toBe('3일 4시간');
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe('5시간 12분');
    expect(formatUptime(42 * 60)).toBe('42분');
  });
});
