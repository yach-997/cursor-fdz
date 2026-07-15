import sharp from 'sharp';

export interface WatermarkMeta {
  timestamp: string;
  gps?: string;
  serialNumber: string;
  inspectorName: string;
  siteName: string;
}

/** 右下角叠加水印：白字 + 黑半透明底，字号 24px */
export async function applyWatermark(
  imageBuffer: Buffer,
  meta: WatermarkMeta,
): Promise<Buffer> {
  // 先修正手机照片的 EXIF 方向，并读取真实输出尺寸。小图直接叠加固定水印会触发
  // sharp 的 “Image to composite must have same dimensions or smaller”。
  const normalized = await sharp(imageBuffer)
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const lines = [
    meta.timestamp,
    meta.gps || 'GPS:未知',
    `设备:${meta.serialNumber}`,
    `巡检员:${meta.inspectorName}`,
    `站点:${meta.siteName}`,
  ];

  const fontSize = 24;
  const lineHeight = 32;
  const padding = 12;
  const textWidth = Math.max(...lines.map((l) => l.length)) * 14 + padding * 2;
  const textHeight = lines.length * lineHeight + padding * 2;

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="${padding}" y="${padding + fontSize + i * lineHeight}" font-size="${fontSize}" font-family="Arial,sans-serif" fill="white">${escapeXml(line)}</text>`,
    )
    .join('');

  const svg = `<svg width="${textWidth}" height="${textHeight}">
    <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" rx="4"/>
    ${textSvg}
  </svg>`;

  const maxOverlayWidth = Math.max(1, normalized.info.width - 12);
  const maxOverlayHeight = Math.max(1, normalized.info.height - 12);
  const overlay = await sharp(Buffer.from(svg))
    .resize({
      width: maxOverlayWidth,
      height: maxOverlayHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  return sharp(normalized.data)
    .composite([
      {
        input: overlay,
        gravity: 'southeast',
      },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
