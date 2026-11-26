// news-image-20261125 v3 — entrypoint.
//
// The finished 1024x1024 entry.png sits next to this file. This script
// validates it byte by byte and then copies it to
// $MAKEFUN_OUTPUT_DIR/entry.png:
//   * PNG magic signature
//   * IHDR is the first chunk, 13 bytes, 1024x1024, 8-bit depth, RGB
//     (color type 2)
//   * a full walk over every chunk, checking length bounds and the
//     CRC-32 of each chunk's type + data
//   * at least one non-empty IDAT chunk, a well-formed IEND, no trailing
//     bytes, and total size at most 1 MiB
// After copying, the output file is read back and its sha256 and size
// must match the source exactly. Node 22 stdlib only — no dependencies,
// no network. A plain copy, so two runs are byte-identical.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "entry.png");

const outDir = process.env.MAKEFUN_OUTPUT_DIR;
if (!outDir) {
  console.error("MAKEFUN_OUTPUT_DIR is not set");
  process.exit(1);
}

function die(message) {
  console.error("PNG validation failed: " + message);
  process.exit(1);
}

// CRC-32 (IEEE 802.3 polynomial), table-driven, pure JS.
const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  TABLE[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const png = readFileSync(SOURCE);
if (png.length < 8 + 25) die("file too short to hold a PNG header");

const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!png.subarray(0, 8).equals(MAGIC)) die("bad PNG signature");

let offset = 8;
let chunkCount = 0;
let foundIHDR = false;
let foundIDAT = false;
let foundIEND = false;

while (offset < png.length) {
  if (offset + 8 > png.length) die("truncated chunk header at offset " + offset);
  const length = png.readUInt32BE(offset);
  const type = png.subarray(offset + 4, offset + 8).toString("ascii");
  const dataStart = offset + 8;
  const dataEnd = dataStart + length;
  const chunkEnd = dataEnd + 4;
  if (chunkEnd > png.length) die("truncated " + type + " chunk");
  const storedCrc = png.readUInt32BE(dataEnd);
  const computedCrc = crc32(png.subarray(offset + 4, dataEnd));
  if (storedCrc !== computedCrc) die("CRC-32 mismatch in " + type + " chunk");

  if (type === "IHDR") {
    foundIHDR = true;
    if (offset !== 8) die("IHDR is not the first chunk");
    if (length !== 13) die("IHDR must be 13 bytes, got " + length);
    const width = png.readUInt32BE(dataStart);
    const height = png.readUInt32BE(dataStart + 4);
    if (width !== 1024 || height !== 1024) {
      die("expected 1024x1024, got " + width + "x" + height);
    }
    if (png[dataStart + 8] !== 8) die("expected 8-bit depth, got " + png[dataStart + 8]);
    if (png[dataStart + 9] !== 2) die("expected RGB color type 2, got " + png[dataStart + 9]);
  }
  if (type === "IDAT" && length > 0) foundIDAT = true;
  if (type === "IEND") {
    foundIEND = true;
    if (length !== 0) die("IEND must be empty");
    if (chunkEnd !== png.length) die("trailing bytes after IEND");
  }
  chunkCount++;
  offset = chunkEnd;
}

if (!foundIHDR) die("missing IHDR");
if (!foundIEND) die("missing IEND");
if (!foundIDAT) die("missing non-empty IDAT chunk (no image data)");
if (png.length > 1024 * 1024) die("entry.png exceeds 1 MiB (" + png.length + " bytes)");

const sourceSha = createHash("sha256").update(png).digest("hex");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "entry.png");
copyFileSync(SOURCE, outPath);

const copied = readFileSync(outPath);
if (copied.length !== png.length) die("output size mismatch after copy");
const copiedSha = createHash("sha256").update(copied).digest("hex");
if (copiedSha !== sourceSha) {
  die("output sha256 mismatch after copy: " + copiedSha + " != " + sourceSha);
}
console.log(
  `entry.png OK: 1024x1024, ${chunkCount} chunks, CRC-32 verified, ` +
    `${png.length} bytes, sha256 ${sourceSha}, copy verified`,
);
