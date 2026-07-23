const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 生成简单的 PNG 图标（81x81）
function createPNG(width, height, drawFn) {
  const pixels = Buffer.alloc(width * height * 4);
  
  // 绘制图标
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = a;
    }
  }
  
  // 创建 PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  
  const ihdr = createChunk('IHDR', ihdrData);
  
  // IDAT
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter none
    pixels.copy(rawData, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);
  
  // IEND
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 仪表盘图标（饼图）
function drawDashboard(x, y, w, h, color) {
  const cx = w / 2, cy = h / 2;
  const radius = w * 0.35;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist <= radius) {
    // 饼图扇形
    const angle = Math.atan2(dy, dx);
    if (angle < -Math.PI / 2 || angle > Math.PI / 2) {
      return [color[0], color[1], color[2], 255];
    }
  }
  return [0, 0, 0, 0];
}

// 记录图标（列表）
function drawRecords(x, y, w, h, color) {
  const margin = w * 0.2;
  const lineHeight = h * 0.15;
  const startY = h * 0.25;
  const lineWidth = w * 0.6;
  
  for (let i = 0; i < 3; i++) {
    const ly = startY + i * (lineHeight + h * 0.1);
    if (y >= ly && y <= ly + lineHeight && x >= margin && x <= margin + lineWidth) {
      return [color[0], color[1], color[2], 255];
    }
  }
  return [0, 0, 0, 0];
}

// 我的图标（人形）
function drawProfile(x, y, w, h, color) {
  const cx = w / 2;
  const headRadius = w * 0.2;
  const headY = h * 0.35;
  const bodyWidth = w * 0.5;
  const bodyHeight = h * 0.35;
  const bodyY = h * 0.55;
  
  // 头部
  const dx = x - cx, dy = y - headY;
  if (Math.sqrt(dx * dx + dy * dy) <= headRadius) {
    return [color[0], color[1], color[2], 255];
  }
  
  // 身体
  if (y >= bodyY && y <= bodyY + bodyHeight && x >= cx - bodyWidth / 2 && x <= cx + bodyWidth / 2) {
    return [color[0], color[1], color[2], 255];
  }
  
  return [0, 0, 0, 0];
}

const iconsDir = path.join(__dirname, '../assets/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const size = 81;
const grayColor = [145, 150, 160]; // #9196A0
const activeColor = [27, 40, 75]; // #1B284B

// 生成图标
fs.writeFileSync(path.join(iconsDir, 'dashboard.png'), createPNG(size, size, (x, y, w, h) => drawDashboard(x, y, w, h, grayColor)));
fs.writeFileSync(path.join(iconsDir, 'dashboard-active.png'), createPNG(size, size, (x, y, w, h) => drawDashboard(x, y, w, h, activeColor)));
fs.writeFileSync(path.join(iconsDir, 'records.png'), createPNG(size, size, (x, y, w, h) => drawRecords(x, y, w, h, grayColor)));
fs.writeFileSync(path.join(iconsDir, 'records-active.png'), createPNG(size, size, (x, y, w, h) => drawRecords(x, y, w, h, activeColor)));
fs.writeFileSync(path.join(iconsDir, 'profile.png'), createPNG(size, size, (x, y, w, h) => drawProfile(x, y, w, h, grayColor)));
fs.writeFileSync(path.join(iconsDir, 'profile-active.png'), createPNG(size, size, (x, y, w, h) => drawProfile(x, y, w, h, activeColor)));

console.log('TabBar icons generated in assets/icons/');
