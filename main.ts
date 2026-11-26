// main.ts — copy the finished entry.png to the make.fun output directory.
//
// The image itself lives in entry.png next to this file. This script only
// validates it and copies it: PNG signature, IHDR dimensions, a full
// chunk walk with a CRC-32 check of every chunk, and a 1 MiB size cap.
// Node.js 22+, no dependencies, no network access.
//
// Run: MAKEFUN_OUTPUT_DIR=out node main.ts
// Writes: out/entry.png (1024x1024)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (IEEE 802.3, polynomial 0xedb88320), built once at startup.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fail(message) {
  throw new Error('entry.png validation failed: ' + message);
}

// Validate the PNG structure and return its [width, height].
function validatePng(buf) {
  if (buf.length > MAX_BYTES) fail('size ' + buf.length + ' bytes exceeds 1 MiB');
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail('bad PNG signature');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let seenIhdr = false;
  let seenIdat = false;
  let seenIend = false;
  while (offset < buf.length) {
    if (offset + 12 > buf.length) fail('truncated chunk header at offset ' + offset);
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (offset + 12 + length > buf.length) fail('truncated ' + type + ' chunk');
    const storedCrc = buf.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(buf.subarray(offset + 4, offset + 8 + length));
    if (storedCrc !== actualCrc) fail(type + ' chunk CRC mismatch');
    if (!seenIhdr) {
      if (type !== 'IHDR') fail('first chunk is ' + type + ', not IHDR');
      width = buf.readUInt32BE(offset + 8);
      height = buf.readUInt32BE(offset + 12);
      seenIhdr = true;
    }
    if (type === 'IDAT') seenIdat = true;
    if (type === 'IEND') {
      if (length !== 0) fail('IEND chunk is not empty');
      if (offset + 12 + length !== buf.length) fail('trailing bytes after IEND');
      seenIend = true;
      break;
    }
    offset += 12 + length;
  }
  if (!seenIhdr) fail('missing IHDR chunk');
  if (!seenIdat) fail('missing IDAT chunk');
  if (!seenIend) fail('missing IEND chunk');
  return [width, height];
}

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'entry.png');

const outDir = process.env.MAKEFUN_OUTPUT_DIR;
if (!outDir) throw new Error('MAKEFUN_OUTPUT_DIR is not set');
const out = join(outDir, 'entry.png');

const png = readFileSync(src);
const [width, height] = validatePng(png);
if (width !== 1024 || height !== 1024) {
  fail('expected 1024x1024, got ' + width + 'x' + height);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(out, png);

const sha256 = createHash('sha256').update(png).digest('hex');
console.log('entry.png: ' + png.length + ' bytes, ' + width + 'x' + height + ', sha256 ' + sha256);
console.log('wrote ' + out);
