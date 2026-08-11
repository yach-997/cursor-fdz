/**
 * Multer 常把 UTF-8 文件名按 Latin-1 解读，导致中文变成 æµ‹è¯• 这类乱码。
 * 优先使用前端显式传来的 originalFilename；否则尝试 Latin-1 → UTF-8 还原。
 */
export function decodeUploadFilename(name: string | undefined | null): string {
  const raw = String(name || '').trim();
  if (!raw) return '';
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    if (!fixed || fixed.includes('\uFFFD') || fixed === raw) return raw;
    const rawCJK = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
    const fixedCJK = (fixed.match(/[\u4e00-\u9fff]/g) || []).length;
    // 还原后中文更多，或原文几乎无中文但含典型乱码字节痕迹
    if (fixedCJK > rawCJK || (rawCJK === 0 && /[ÃÂæçåéøï]/.test(raw))) {
      return fixed;
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

/** 统一得到可读的上传文件名（客户端优先） */
export function resolveUploadFilename(
  file: { originalname?: string },
  clientFilename?: string | null,
): string {
  const fromClient = String(clientFilename || '').trim();
  if (fromClient) return fromClient;
  return decodeUploadFilename(file?.originalname);
}

/**
 * 修复「由{乱码文件名}清单模板导入」这类已落库备注。
 */
export function repairImportChangeRemark(
  remark: string | null | undefined,
): string | null {
  if (remark == null || remark === '') return remark ?? null;
  const m = remark.match(
    /^(由)(.+?)(清单模板导入|初始化，已应用0\.990应答系数|导入内部绩效价)$/,
  );
  if (!m) return remark;
  const fixedName = decodeUploadFilename(m[2]);
  if (fixedName === m[2]) return remark;
  return `${m[1]}${fixedName}${m[3]}`;
}
