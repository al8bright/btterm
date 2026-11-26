import { describe, expect, it } from 'vitest';
import { DroppedPaths } from './DroppedPaths';

describe('DroppedPaths(보안 리뷰 #1)', () => {
  it('등록한 창에서만, 만료 전에, 한 번만 쓸 수 있다', () => {
    let now = 0;
    const paths = new DroppedPaths(() => now);
    const a = {};
    const b = {};
    paths.register(a, 'C:/x.txt');
    expect(paths.consume(b, ['C:/x.txt'])).toBe(false);
    expect(paths.consume(a, ['C:/x.txt'])).toBe(true);
    expect(paths.consume(a, ['C:/x.txt'])).toBe(false);

    paths.register(a, 'C:/y.txt');
    now = 61_000;
    expect(paths.consume(a, ['C:/y.txt'])).toBe(false);
  });

  it('하나라도 등록되지 않은 경로가 있으면 아무것도 쓰지 않는다', () => {
    const paths = new DroppedPaths(() => 0);
    const a = {};
    paths.register(a, 'C:/ok.txt');
    expect(paths.consume(a, ['C:/ok.txt', 'C:/Users/me/.ssh/id_ed25519'])).toBe(false);
    expect(paths.consume(a, ['C:/ok.txt'])).toBe(true);
  });
});
