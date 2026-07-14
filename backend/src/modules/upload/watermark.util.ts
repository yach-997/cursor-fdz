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

  return sharp(imageBuffer)
    .rotate()
    .composite([
      {
        input: Buffer.from(svg),
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
