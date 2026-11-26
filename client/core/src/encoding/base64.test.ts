import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64';

describe('base64', () => {
  it('RFC 4648 예시를 인코딩한다', () => {
    const enc = (s: string) => encodeBase64(new TextEncoder().encode(s));
    expect(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'].map(enc)).toEqual([
      '',
      'Zg==',
      'Zm8=',
      'Zm9v',
      'Zm9vYg==',
      'Zm9vYmE=',
      'Zm9vYmFy',
    ]);
  });

  it('padding 생략 옵션', () => {
    expect(encodeBase64(new TextEncoder().encode('f'), { padding: false })).toBe('Zg');
  });

  it('디코딩은 인코딩의 역이다', () => {
    const data = new Uint8Array([0, 255, 128, 7, 66]);
    expect(decodeBase64(encodeBase64(data))).toEqual(data);
  });

  it('잘못된 문자가 있으면 예외', () => {
    expect(() => decodeBase64('ab$=')).toThrow();
  });
});
