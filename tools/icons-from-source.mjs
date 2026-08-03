// 從 tools/source.png（一張正方形高解析度圖）切出 PWA 需要的所有尺寸。
//   node tools/icons-from-source.mjs
// 會做三件事：抹掉右下角的產生器浮水印、面積平均縮圖、依用途決定圓角或滿版。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = join(HERE, '..', 'icons');   // 產出：會被部署
const SOURCE = join(HERE, 'source.png');   // 原圖：留在 tools/，不要放進 icons/ 拖累部署體積

// 浮水印位置（正規化 0..1）。換圖後如果位置不同，改這裡；設成 null 就不處理。
const WATERMARK = { x0: 0.850, y0: 0.850, x1: 0.915, y1: 0.915 };

const CORNER_RADIUS = 0.22;  // 圓角半徑，佔邊長比例

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon-180.png', size: 180, rounded: false },
  { file: 'favicon-32.png', size: 32, rounded: true },
];

/**
 * 把指定矩形塗掉：用四邊的顏色做雙線性內插填回去。
 * 背景是接近純色的暗底（帶一點暈影），這樣補完看不出痕跡。
 */
function inpaint(img, rect) {
  const { width: w, height: h, data } = img;
  const x0 = Math.max(1, Math.floor(rect.x0 * w));
  const y0 = Math.max(1, Math.floor(rect.y0 * h));
  const x1 = Math.min(w - 2, Math.ceil(rect.x1 * w));
  const y1 = Math.min(h - 2, Math.ceil(rect.y1 * h));
  const get = (x, y, c) => data[(y * w + x) * 4 + c];

  for (let y = y0; y <= y1; y++) {
    const v = (y - y0) / Math.max(1, y1 - y0);
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      for (let c = 0; c < 3; c++) {
        const horiz = (1 - u) * get(x0 - 1, y, c) + u * get(x1 + 1, y, c);
        const vert = (1 - v) * get(x, y0 - 1, c) + v * get(x, y1 + 1, c);
        data[(y * w + x) * 4 + c] = Math.round((horiz + vert) / 2);
      }
    }
  }
  console.log(`  抹除浮水印：(${x0},${y0}) → (${x1},${y1})`);
}

/** 面積平均縮圖（只用於縮小，品質等同 box filter） */
function resize(img, size) {
  const { width: sw, height: sh, data } = img;
  const out = Buffer.alloc(size * size * 4);
  const fx = sw / size, fy = sh / size;

  for (let ty = 0; ty < size; ty++) {
    const sy0 = ty * fy, sy1 = sy0 + fy;
    for (let tx = 0; tx < size; tx++) {
      const sx0 = tx * fx, sx1 = sx0 + fx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;

      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        const wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          const wx = Math.min(x + 1, sx1) - Math.max(x, sx0);
          const weight = wx * wy;
          const i = (y * sw + x) * 4;
          r += data[i] * weight; g += data[i + 1] * weight;
          b += data[i + 2] * weight; a += data[i + 3] * weight;
          wsum += weight;
        }
      }
      const o = (ty * size + tx) * 4;
      out[o] = Math.round(r / wsum);
      out[o + 1] = Math.round(g / wsum);
      out[o + 2] = Math.round(b / wsum);
      out[o + 3] = Math.round(a / wsum);
    }
  }
  return { width: size, height: size, data: out };
}

/** 切圓角（改 alpha，邊緣做 1px 抗鋸齒） */
function roundCorners(img) {
  const { width: n, data } = img;
  const r = CORNER_RADIUS * n;
  const half = n / 2;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const qx = Math.abs(x + 0.5 - half) - (half - r);
      const qy = Math.abs(y + 0.5 - half) - (half - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
      const cov = Math.min(1, Math.max(0, 0.5 - d));
      if (cov < 1) {
        const i = (y * n + x) * 4 + 3;
        data[i] = Math.round(data[i] * cov);
      }
    }
  }
  return img;
}

// ---------------- main ----------------
console.log('讀取', SOURCE);
const src = decodePNG(readFileSync(SOURCE));
console.log(`  ${src.width} x ${src.height}`);
if (src.width !== src.height) console.warn('  ⚠ 來源不是正方形，縮圖會變形');

if (WATERMARK) inpaint(src, WATERMARK);

for (const { file, size, rounded } of OUTPUTS) {
  let img = resize(src, size);
  if (rounded) img = roundCorners(img);
  // 滿版的不需要 alpha，存成 RGB 省體積
  const png = encodePNG(img, { hasAlpha: rounded });
  writeFileSync(join(ICONS, file), png);
  console.log(`✓ ${file.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB  ${rounded ? '圓角+透明' : '滿版'}`);
}
