// プレースホルダーのアプリアイコン（PNG）を生成する。
// 依存を増やさず Node 標準（zlib）だけで PNG を符号化する。後で本番アイコンに差し替え可。
// 使い方: node scripts/gen-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/icons');
mkdirSync(outDir, { recursive: true });

const BLUE = [0x25, 0x63, 0xeb];
const WHITE = [0xff, 0xff, 0xff];

// 点 (px,py) と線分 (a→b) の距離。チェックマークを太線で描くために使う。
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// 青の正方形に白いチェックマーク（icon.svg に対応する簡易ラスタ）。
function renderIconRgb(size) {
  const s = size;
  const p1x = 0.3 * s;
  const p1y = 0.52 * s;
  const p2x = 0.44 * s;
  const p2y = 0.66 * s;
  const p3x = 0.72 * s;
  const p3y = 0.34 * s;
  const half = 0.052 * s;

  // 各行: フィルタバイト(0) + RGB * 幅
  const raw = Buffer.alloc(s * (1 + s * 3));
  let o = 0;
  for (let y = 0; y < s; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < s; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const d = Math.min(
        distToSegment(cx, cy, p1x, p1y, p2x, p2y),
        distToSegment(cx, cy, p2x, p2y, p3x, p3y),
      );
      const c = d <= half ? WHITE : BLUE;
      raw[o++] = c[0];
      raw[o++] = c[1];
      raw[o++] = c[2];
    }
  }
  return raw;
}

// --- 最小 PNG エンコーダ（color type 2 = RGB, 8bit） ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rawRgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(rawRgb, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIcon(name, size) {
  const png = encodePng(size, size, renderIconRgb(size));
  writeFileSync(resolve(outDir, name), png);
  console.log(`  wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}

console.log('generating placeholder icons →', outDir);
writeIcon('icon-192.png', 192);
writeIcon('icon-512.png', 512);
writeIcon('maskable-512.png', 512);
writeIcon('apple-touch-icon.png', 180);
console.log('done.');
