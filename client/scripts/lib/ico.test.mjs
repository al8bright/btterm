import { describe, expect, it } from 'vitest';
import { buildIco } from './ico.mjs';

const png = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(n).fill(7)]);

describe('ICO 묶기 (DESIGN §2.8 앱 아이콘)', () => {
  it('PNG를 크기순 항목으로 담고, 각 항목이 자기 PNG를 가리킨다', () => {
    const images = [
      { size: 256, png: png(10) },
      { size: 16, png: png(3) },
    ];
    const ico = buildIco(images);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // 1 = icon
    expect(ico.readUInt16LE(4)).toBe(2); // 항목 수
    const entry = (i) => {
      const at = 6 + i * 16;
      return {
        width: ico[at],
        height: ico[at + 1],
        planes: ico.readUInt16LE(at + 4),
        bpp: ico.readUInt16LE(at + 6),
        bytes: ico.readUInt32LE(at + 8),
        offset: ico.readUInt32LE(at + 12),
      };
    };
    // 작은 것 먼저, 256은 0으로 적는다
    expect(entry(0)).toMatchObject({
      width: 16,
      height: 16,
      planes: 1,
      bpp: 32,
      bytes: 7,
      offset: 38,
    });
    expect(entry(1)).toMatchObject({ width: 0, height: 0, bytes: 14, offset: 45 });
    expect(ico.subarray(38, 45)).toEqual(png(3));
    expect(ico.subarray(45)).toEqual(png(10));
  });

  it('256보다 큰 크기는 받지 않는다', () => {
    expect(() => buildIco([{ size: 512, png: png(1) }])).toThrow();
  });
});
