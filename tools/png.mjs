// 最小的 PNG 編解碼器（只用 node:zlib，無第三方相依）
// 支援 8-bit、非交錯、colorType 0/2/4/6
import { deflateSync, inflateSync } from 'node:zlib';

// ---------- 解碼 ----------
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 檔');

  let p = 8;
  let ihdr = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  if (!ihdr) throw new Error('缺少 IHDR');
  if (ihdr.depth !== 8) throw new Error(`只支援 8-bit，這張是 ${ihdr.depth}-bit`);
  if (ihdr.interlace !== 0) throw new Error('不支援交錯式 PNG');

  const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const ch = CHANNELS[ihdr.colorType];
  if (!ch) throw new Error(`不支援 colorType ${ihdr.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const { width: w, height: h } = ihdr;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);

  let sp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[sp++];
    const row = raw.subarray(sp, sp + stride);
    sp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;      // 左
      const b = prev ? prev[i] : 0;             // 上
      const c = prev && i >= ch ? prev[i - ch] : 0; // 左上
      let v = row[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`未知的 filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
  }

  // 一律轉成 RGBA 方便後續處理
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch, d = i * 4;
    if (ihdr.colorType === 0) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = 255;
    } else if (ihdr.colorType === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = out[s + 1];
    } else if (ihdr.colorType === 2) {
      rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = 255;
    } else {
      out.copy(rgba, d, s, s + 4);
    }
  }
  return { width: w, height: h, data: rgba };
}

// ---------- 編碼 ----------
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

/**
 * 逐列挑最省的 filter（標準 minimum-sum-of-absolute-differences 啟發式）。
 * 漸層圖用 filter 0 存會大到不像話，這一步通常能砍掉一半以上。
 */
function filterRows(data, w, h, ch) {
  const stride = w * ch;
  const out = Buffer.alloc(h * (stride + 1));
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride),
                Buffer.alloc(stride), Buffer.alloc(stride)];

  for (let y = 0; y < h; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      const x = cur[i];
      cand[0][i] = x;
      cand[1][i] = (x - a) & 0xff;
      cand[2][i] = (x - b) & 0xff;
      cand[3][i] = (x - ((a + b) >> 1)) & 0xff;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      cand[4][i] = (x - pred) & 0xff;
    }

    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0;
      for (let i = 0; i < stride; i++) {
        const v = cand[f][i];
        s += v < 128 ? v : 256 - v;
      }
      if (s < bestScore) { bestScore = s; best = f; }
    }

    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  return out;
}

/** data 為 RGBA；hasAlpha=false 時輸出 RGB（省 25% 體積） */
export function encodePNG({ width, height, data }, { hasAlpha = true } = {}) {
  const ch = hasAlpha ? 4 : 3;
  let px = data;
  if (!hasAlpha) {
    px = Buffer.alloc(width * height * 3);
    for (let i = 0, n = width * height; i < n; i++) {
      px[i * 3] = data[i * 4];
      px[i * 3 + 1] = data[i * 4 + 1];
      px[i * 3 + 2] = data[i * 4 + 2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = hasAlpha ? 6 : 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filterRows(px, width, height, ch), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
