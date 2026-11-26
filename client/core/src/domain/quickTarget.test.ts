import { describe, expect, it } from 'vitest';
import { parseQuickTarget } from './quickTarget';

describe('parseQuickTarget (F1.3)', () => {
  it.each([
    ['btterm@127.0.0.1:2222', { username: 'btterm', host: '127.0.0.1', port: 2222 }],
    ['ubuntu@web-01', { username: 'ubuntu', host: 'web-01', port: 22 }],
    ['  root@[::1]:2200 ', { username: 'root', host: '::1', port: 2200 }],
    ['root@[fe80::1]', { username: 'root', host: 'fe80::1', port: 22 }],
    ['ssh ubuntu@web-01', { username: 'ubuntu', host: 'web-01', port: 22 }],
    ['ssh -p 2022 ubuntu@web-01', { username: 'ubuntu', host: 'web-01', port: 2022 }],
  ])('%s', (input, expected) => {
    expect(parseQuickTarget(input)).toEqual(expected);
  });

  it.each([
    'web-01',
    '@host',
    'user@',
    'user@host:0',
    'user@host:70000',
    'user@host:ab',
    'a b@host',
  ])('잘못된 입력 %s는 null', (input) => {
    expect(parseQuickTarget(input)).toBeNull();
  });
});
