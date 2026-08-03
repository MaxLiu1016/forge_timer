// 產生 App 圖示（純 Node，無相依套件）：node tools/make-icons.mjs
// 主視覺：一圈剛從爐子裡拉出來的鐵環 —— 右上白熱、繞一圈慢慢冷卻成暗鐵，
// 外圈帶橘紅輝光。中間留計時器指針，維持「這是計時 App」的辨識度。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [11, 15, 20];
const STEEL = [226, 233, 242];
const GLOW = [255, 104, 56];

// 溫度色階：0 = 冷卻的暗鐵，1 = 白熱
const HEAT_RAMP = [
  [0.0, [44, 50, 60]],
  [0.3, [104, 34, 24]],
  [0.55, [226, 74, 44]],
  [0.75, [255, 132, 58]],
  [0.9, [255, 189, 104]],
  [1.0, [255, 240, 214]],
];

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function heatColor(h) {
  h = clamp01(h);
  for (let i = 1; i < HEAT_RAMP.length; i++) {
    const [p0, c0] = HEAT_RAMP[i - 1];
    const [p1, c1] = HEAT_RAMP[i];
    if (h <= p1) return lerp(c0, c1, (h - p0) / (p1 - p0));
  }
  return HEAT_RAMP[HEAT_RAMP.length - 1][1];
}

/** 一格像素的顏色（含 alpha），座標以 0..1 正規化 */
function shade(x, y, { pad, rounded }) {
  const dx = x - 0.5, dy = y - 0.5;
  const d = Math.hypot(dx, dy);

  // 底：圓角方形（rounded=true）或整片填滿（maskable 交給系統去切）
  if (rounded) {
    const r = 0.22;
    const qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
    const qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  }

  const outer = 0.36 * pad;
  const thick = 0.085 * pad;
  const mid = outer - thick / 2;          // 環的中心線
  const band = Math.abs(d - mid);         // 離中心線的距離

  // 角度：正上方為 0，順時針 0..1
  let ang = Math.atan2(dx, -dy) / (Math.PI * 2);
  if (ang < 0) ang += 1;

  // 溫度分佈：右上最燙，繞到左下最冷
  const heat = Math.pow((Math.cos((ang - 0.12) * Math.PI * 2) + 1) / 2, 1.5);

  // 左下留一個缺口，讀起來才像「進度環」而不是實心甜甜圈
  const gap = ang > 0.60 && ang < 0.665;

  let col = BG;

  if (band <= thick / 2 && !gap) {
    // 環身：截面中間亮、兩側暗，一來像有厚度的鐵條，二來邊緣自然壓出一圈暗邊，
    // 不會被外面的輝光暈成一團
    const t = (d - mid) / (thick / 2);
    const shape = 1.18 - 0.72 * t * t;
    col = heatColor(heat).map((v) => Math.min(255, v * shape));
  } else {
    // 輝光。落差要夠陡，環身才不會被暈開；環內只給一半，免得中間發灰蓋掉指針
    const outside = d > mid;
    const falloff = (outside ? 0.030 : 0.022) * pad;
    const g = Math.exp(-Math.max(0, band - thick / 2) / falloff) * heat * (outside ? 0.55 : 0.28);
    col = BG.map((v, i) => Math.min(255, v + GLOW[i] * g));
  }

  // 中央指針 + 圓心
  const inner = mid - thick / 2 - 0.035 * pad;
  const onHand = dy <= 0 && dy >= -inner * 0.78 && Math.abs(dx) <= 0.026 * pad;
  const onDot = d <= 0.045 * pad;
  if (onHand || onDot) col = STEEL;

  return [...col, 255];
}

function render(size, opts) {
  const S = 3; // 3x3 超取樣做抗鋸齒
  const buf = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let py = 0; py < size; py++) {
    buf[p++] = 0; // filter type: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = shade((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size, opts);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = S * S;
      buf[p++] = a ? Math.round(r / a) : 0;
      buf[p++] = a ? Math.round(g / a) : 0;
      buf[p++] = a ? Math.round(b / a) : 0;
      buf[p++] = Math.round(a / n);
    }
  }
  return buf;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, opts) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size, opts), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const jobs = [
  ['icon-192.png', 192, { pad: 1, rounded: true }],
  ['icon-512.png', 512, { pad: 1, rounded: true }],
  ['icon-maskable-512.png', 512, { pad: 0.72, rounded: false }],
];

for (const [name, size, opts] of jobs) {
  writeFileSync(join(OUT, name), png(size, opts));
  console.log('✓', name, `${size}x${size}`);
}
