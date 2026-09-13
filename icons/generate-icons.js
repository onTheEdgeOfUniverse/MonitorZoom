const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 implementation for PNG chunks
function makeCrcTable() {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writePng(width, height, rgbaBuffer) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression: 0 (deflate)
  ihdr[11] = 0; // Filter: 0
  ihdr[12] = 0; // Interlace: 0

  function createChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const length = data.length;
    const chunk = Buffer.alloc(4 + 4 + length + 4);
    chunk.writeUInt32BE(length, 0);
    typeBuf.copy(chunk, 4);
    data.copy(chunk, 8);
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    chunk.writeUInt32BE(crcVal, 8 + length);
    return chunk;
  }

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Scanlines with filter byte 0
  const scanlineWidth = width * 4;
  const rawScanlines = Buffer.alloc((scanlineWidth + 1) * height);

  for (let y = 0; y < height; y++) {
    rawScanlines[y * (scanlineWidth + 1)] = 0; // filter 0
    rgbaBuffer.copy(
      rawScanlines,
      y * (scanlineWidth + 1) + 1,
      y * scanlineWidth,
      (y + 1) * scanlineWidth
    );
  }

  const compressedData = zlib.deflateSync(rawScanlines);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function generateIcon(size) {
  const buf = Buffer.alloc(size * size * 4); // RGBA

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (Math.floor(y) * size + Math.floor(x)) * 4;
    const srcA = a / 255;
    const dstA = buf[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA > 0) {
      buf[idx] = Math.round((r * srcA + buf[idx] * dstA * (1 - srcA)) / outA);
      buf[idx + 1] = Math.round((g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
      buf[idx + 2] = Math.round((b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
      buf[idx + 3] = Math.round(outA * 255);
    }
  }

  const s = size;
  const cornerR = Math.max(2, Math.floor(s * 0.15));

  // Screen bounds
  const monX1 = Math.floor(s * 0.08);
  const monY1 = Math.floor(s * 0.08);
  const monX2 = Math.floor(s * 0.92);
  const monY2 = Math.floor(s * 0.72);

  // Draw monitor outer frame
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // Screen outer frame (blue gradient)
      if (x >= monX1 && x <= monX2 && y >= monY1 && y <= monY2) {
        const dx = Math.min(x - monX1, monX2 - x);
        const dy = Math.min(y - monY1, monY2 - y);
        if (dx < cornerR && dy < cornerR) {
          const dist = Math.hypot(cornerR - dx, cornerR - dy);
          if (dist > cornerR) continue;
        }
        const t = (y - monY1) / (monY2 - monY1);
        const r = Math.round(37 * (1 - t) + 29 * t);
        const g = Math.round(99 * (1 - t) + 78 * t);
        const b = Math.round(235 * (1 - t) + 216 * t);
        setPixel(x, y, r, g, b, 255);
      }

      // Stand neck
      const neckW = Math.max(2, Math.floor(s * 0.12));
      const neckLeft = Math.floor((s - neckW) / 2);
      if (x >= neckLeft && x <= neckLeft + neckW && y >= monY2 && y <= Math.floor(s * 0.85)) {
        setPixel(x, y, 100, 116, 139, 255);
      }

      // Stand base
      const baseW = Math.max(4, Math.floor(s * 0.44));
      const baseLeft = Math.floor((s - baseW) / 2);
      const baseY1 = Math.floor(s * 0.83);
      const baseY2 = Math.floor(s * 0.92);
      if (x >= baseLeft && x <= baseLeft + baseW && y >= baseY1 && y <= baseY2) {
        setPixel(x, y, 148, 163, 184, 255);
      }
    }
  }

  // Inner screen area (dark navy/indigo)
  const bezel = Math.max(1, Math.floor(s * 0.07));
  const scrX1 = monX1 + bezel;
  const scrY1 = monY1 + bezel;
  const scrX2 = monX2 - bezel;
  const scrY2 = monY2 - bezel;

  for (let y = scrY1; y <= scrY2; y++) {
    for (let x = scrX1; x <= scrX2; x++) {
      setPixel(x, y, 15, 23, 42, 255); // #0f172a
    }
  }

  // Magnifying glass / zoom icon inside screen
  const cx = Math.floor(s * 0.44);
  const cy = Math.floor(s * 0.38);
  const radius = Math.max(2, Math.floor(s * 0.18));
  const stroke = Math.max(1, Math.floor(s * 0.06));

  for (let y = scrY1; y <= scrY2; y++) {
    for (let x = scrX1; x <= scrX2; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      // Ring
      if (Math.abs(dist - radius) <= stroke / 2) {
        setPixel(x, y, 56, 189, 248, 255); // Sky blue #38bdf8
      }

      // Handle of magnifier
      const hx = x - (cx + radius * 0.7);
      const hy = y - (cy + radius * 0.7);
      const handleLen = radius * 0.85;
      if (hx >= 0 && hy >= 0 && Math.abs(hx - hy) <= stroke / 1.5 && Math.hypot(hx, hy) <= handleLen) {
        setPixel(x, y, 56, 189, 248, 255);
      }

      // Plus symbol (+) inside the magnifying glass
      if (size >= 32) {
        const plusSize = Math.max(1, Math.floor(radius * 0.45));
        const plusThick = Math.max(1, Math.floor(stroke * 0.8));
        const inH = Math.abs(x - cx) <= plusSize && Math.abs(y - cy) <= plusThick / 2;
        const inV = Math.abs(y - cy) <= plusSize && Math.abs(x - cx) <= plusThick / 2;
        if (inH || inV) {
          setPixel(x, y, 255, 255, 255, 255); // White plus
        }
      }
    }
  }

  return writePng(size, size, buf);
}

const iconsDir = path.join(__dirname);
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 32, 48, 128].forEach(size => {
  const png = generateIcon(size);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
});
