// PNG 여러 장을 Windows .ico 하나로 묶는다(Vista 이후 PNG 항목 지원, DESIGN §2.8).

/**
 * @param {Array<{ size: number, png: Buffer }>} images 정사각 PNG(1~256px)
 * @returns {Buffer}
 */
export function buildIco(images) {
  const sorted = [...images].sort((a, b) => a.size - b.size);
  for (const { size } of sorted) {
    if (!Number.isInteger(size) || size < 1 || size > 256)
      throw new Error(`ICO 크기 범위 밖: ${size}`);
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sorted.length, 4);
  let offset = 6 + sorted.length * 16;
  const entries = sorted.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size; // 256은 0으로 적는다
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0; // 팔레트 없음
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...sorted.map(({ png }) => png)]);
}
