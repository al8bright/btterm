// 앱 아이콘 만들기(DESIGN §2.8): client/desktop/build/icon.svg·icon-small.svg → icon.ico(16~256), icon.png(512).
// 사용: pnpm icons   (원본 SVG를 바꾼 뒤에만. 결과 파일은 커밋한다)
// 렌더링은 PC에 설치된 Microsoft Edge를 Playwright로 띄워 한다(브라우저를 따로 내려받지 않는다).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildIco } from './lib/ico.mjs';

const buildDir = fileURLToPath(new URL('../desktop/build/', import.meta.url));
const svg = {
  large: readFileSync(join(buildDir, 'icon.svg'), 'utf8'),
  small: readFileSync(join(buildDir, 'icon-small.svg'), 'utf8'),
};
// 16·24px은 획을 굵게 한 원본으로 그린다
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const sourceFor = (size) => (size <= 24 ? svg.small : svg.large);

const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (size) => {
    await page.setViewportSize({ width: size, height: size });
    const sized = sourceFor(size).replace(
      /width="256" height="256"/,
      `width="${size}" height="${size}"`,
    );
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
    );
    return page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
  };
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(size) });
  writeFileSync(join(buildDir, 'icon.ico'), buildIco(images));
  writeFileSync(join(buildDir, 'icon.png'), await render(512));
  console.log(`icons: ${join(buildDir, 'icon.ico')} (${ICO_SIZES.join(', ')}px), icon.png (512px)`);
} finally {
  await browser.close();
}
