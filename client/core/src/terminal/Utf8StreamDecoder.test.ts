import { describe, expect, it } from 'vitest';
import { Utf8StreamDecoder } from './Utf8StreamDecoder';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('Utf8StreamDecoder', () => {
  it('빈 입력은 빈 문자열', () => {
    expect(new Utf8StreamDecoder().decode(new Uint8Array())).toBe('');
  });

  it('ASCII는 그대로 디코딩한다', () => {
    expect(new Utf8StreamDecoder().decode(bytes('ls -lh'))).toBe('ls -lh');
  });

  it('AC6 한글 한 글자의 3바이트가 다른 청크로 와도 한 문자로 복원하고 U+FFFD가 없다', () => {
    const decoder = new Utf8StreamDecoder();
    const han = bytes('안');
    const out =
      decoder.decode(han.slice(0, 1)) +
      decoder.decode(han.slice(1, 2)) +
      decoder.decode(han.slice(2));
    expect(out).toBe('안');
    expect(out).not.toContain('�');
  });

  it('AC6 여러 글자가 임의 경계로 잘려도 원문과 같다', () => {
    const decoder = new Utf8StreamDecoder();
    const all = bytes('echo 안녕하세요 → 보고서_최종.txt');
    let out = '';
    for (let i = 0; i < all.length; i += 2) out += decoder.decode(all.slice(i, i + 2));
    out += decoder.flush();
    expect(out).toBe('echo 안녕하세요 → 보고서_최종.txt');
  });

  it('스트림이 미완성 바이트로 끝나면 flush가 대체 문자를 낸다', () => {
    const decoder = new Utf8StreamDecoder();
    decoder.decode(bytes('안').slice(0, 2));
    expect(decoder.flush()).toBe('�');
  });
});
