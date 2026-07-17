const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Ensure target directory exists
const iconDir = path.join(__dirname, 'src', 'assets', 'icons');
if (!fs.existsSync(iconDir)) {
  fs.mkdirSync(iconDir, { recursive: true });
}

// Write high-res SVG icon as well
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="50%" stop-color="#a855f7" />
      <stop offset="100%" stop-color="#ec4899" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#grad)" />
  <text x="64" y="82" font-size="64" font-family="sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">T</text>
  <circle cx="98" cy="32" r="8" fill="#fef08a" />
</svg>`;

fs.writeFileSync(path.join(iconDir, 'icon.svg'), svgContent, 'utf8');

// Helper to generate minimal valid PNG buffer with gradient purple-to-pink background & white 'T' letter
function generatePNG(size) {
  const width = size;
  const height = size;

  // Each scanline: 1 filter byte (0x00 for none) + width * 4 bytes (RGBA)
  const rowLen = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowLen);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLen;
    rawData[rowOffset] = 0; // filter: none

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const nx = x / width;
      const ny = y / height;

      // Rounded corner check
      const cx = nx - 0.5;
      const cy = ny - 0.5;
      const dist = Math.sqrt(cx * cx + cy * cy);

      // Gradient colors
      let r = Math.round(99 + nx * (236 - 99));
      let g = Math.round(102 + ny * (72 - 102));
      let b = Math.round(241 - nx * (241 - 153));
      let a = 255;

      // Draw simple white 'T' shape in center
      const isHeader = (nx >= 0.28 && nx <= 0.72) && (ny >= 0.25 && ny <= 0.38);
      const isStem = (nx >= 0.43 && nx <= 0.57) && (ny >= 0.38 && ny <= 0.78);
      if (isHeader || isStem) {
        r = 255;
        g = 255;
        b = 255;
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const idatData = zlib.deflateSync(rawData);

  // PNG header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR');
  const ihdrBody = Buffer.alloc(13);
  ihdrBody.writeUInt32BE(width, 0);
  ihdrBody.writeUInt32BE(height, 4);
  ihdrBody[8] = 8;  // bit depth
  ihdrBody[9] = 6;  // color type: RGBA
  ihdrBody[10] = 0; // compression
  ihdrBody[11] = 0; // filter
  ihdrBody[12] = 0; // interlace
  const ihdrCrc = crc32(Buffer.concat([ihdrType, ihdrBody]));

  // IDAT chunk
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(idatData.length, 0);
  const idatType = Buffer.from('IDAT');
  const idatCrc = crc32(Buffer.concat([idatType, idatData]));

  // IEND chunk
  const iendLen = Buffer.alloc(4);
  iendLen.writeUInt32BE(0, 0);
  const iendType = Buffer.from('IEND');
  const iendCrc = crc32(iendType);

  return Buffer.concat([
    signature,
    ihdrLen, ihdrType, ihdrBody, ihdrCrc,
    idatLen, idatType, idatData, idatCrc,
    iendLen, iendType, iendCrc
  ]);
}

// Simple CRC32 calculation for PNG chunks
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return result;
}

[16, 32, 48, 128].forEach(size => {
  const pngBuf = generatePNG(size);
  const filePath = path.join(iconDir, `icon${size}.png`);
  fs.writeFileSync(filePath, pngBuf);
  console.log(`Generated icon${size}.png (${filePath})`);
});
