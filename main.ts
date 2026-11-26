// news-image-20261125 v2 — entrypoint.
// Copies the finished 1024x1024 entry.png next to this file into
// $MAKEFUN_OUTPUT_DIR/entry.png, after validating the PNG byte by byte:
// magic signature, IHDR dimensions (1024x1024), and a full chunk walk
// with CRC-32 verification of every chunk. Node 22 stdlib only, no deps,
// no network. Two runs produce byte-identical output (plain file copy).
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "entry.png");

const outDir = process.env.MAKEFUN_OUTPUT_DIR;
if (!outDir) {
  console.error("MAKEFUN_OUTPUT_DIR is not set");
  process.exit(1);
}

// --- CRC-32 (IEEE, table-driven, pure JS) ---
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

function fail(msg) {
  console.error("PNG validation failed: " + msg);
  process.exit(1);
}

const png = readFileSync(SRC);
if (png.length < 8 + 25) fail("file too short");
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!png.subarray(0, 8).equals(SIG)) fail("bad PNG signature");

// Walk every chunk, verifying length bounds and CRC-32.
let off = 8;
let sawIHDR = false;
let sawIEND = false;
let chunks = 0;
while (off < png.length) {
  if (off + 8 > png.length) fail("truncated chunk header at offset " + off);
  const len = png.readUInt32BE(off);
  const type = png.subarray(off + 4, off + 8).toString("ascii");
  const dataStart = off + 8;
  const dataEnd = dataStart + len;
  const crcEnd = dataEnd + 4;
  if (crcEnd > png.length) fail("truncated chunk " + type);
  const stored = png.readUInt32BE(dataEnd);
  const actual = crc32(png.subarray(off + 4, dataEnd));
  if (stored !== actual) fail("CRC-32 mismatch in " + type + " chunk");
  if (type === "IHDR") {
    sawIHDR = true;
    if (off !== 8) fail("IHDR is not the first chunk");
    const w = png.readUInt32BE(dataStart);
    const h = png.readUInt32BE(dataStart + 4);
    if (w !== 1024 || h !== 1024) fail("expected 1024x1024, got " + w + "x" + h);
  }
  if (type === "IEND") {
    sawIEND = true;
    if (len !== 0) fail("IEND must be empty");
    if (crcEnd !== png.length) fail("trailing bytes after IEND");
  }
  chunks++;
  off = crcEnd;
}
if (!sawIHDR) fail("missing IHDR");
if (!sawIEND) fail("missing IEND");
if (png.length > 1024 * 1024) fail("entry.png exceeds 1 MiB (" + png.length + " bytes)");

const sha = createHash("sha256").update(png).digest("hex");
mkdirSync(outDir, { recursive: true });
copyFileSync(SRC, join(outDir, "entry.png"));
console.log(`entry.png OK: 1024x1024, ${chunks} chunks, CRC-32 verified, ${png.length} bytes, sha256 ${sha}`);
