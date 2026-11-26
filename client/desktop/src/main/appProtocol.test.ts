import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppPath } from './appProtocol';

const root = join('C:', 'app', 'renderer');

describe('resolveAppPath', () => {
  it('루트 요청은 index.html', () => {
    expect(resolveAppPath(root, 'app://btterm/')).toBe(join(root, 'index.html'));
  });

  it('하위 자산 경로를 돌려준다', () => {
    expect(resolveAppPath(root, 'app://btterm/assets/index-abc.js')).toBe(
      join(root, 'assets', 'index-abc.js'),
    );
  });

  it('SEC-7 어떤 경로도 renderer 폴더 밖을 가리키지 않는다', () => {
    const attempts = [
      'app://btterm/../../secret.txt',
      'app://btterm/%2e%2e/%2e%2e/secret.txt',
      'app://btterm/..%5c..%5csecret.txt',
      'app://btterm/assets/..%2f..%2f..%2fsecret.txt',
    ];
    for (const url of attempts) {
      const resolved = resolveAppPath(root, url);
      expect(resolved === null || resolved.startsWith(root), url).toBe(true);
    }
  });

  it('SEC-7 디코딩 후 나타나는 백슬래시·인코딩된 상위 경로는 거부한다', () => {
    expect(resolveAppPath(root, 'app://btterm/..%5c..%5csecret.txt')).toBeNull();
    expect(resolveAppPath(root, 'app://btterm/assets/..%2f..%2f..%2fsecret.txt')).toBeNull();
  });

  it('다른 호스트는 거부한다', () => {
    expect(resolveAppPath(root, 'app://evil/index.html')).toBeNull();
  });
});
