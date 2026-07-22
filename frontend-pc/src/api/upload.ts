import request from '../utils/request';
import type { ApiResponse } from '../types';
import { compressImageForUpload } from '../utils/compress-image';

type QiniuToken = {
  token: string;
  domain: string;
  uploadUrl: string;
  bucket?: string;
};

function objectKey(ext: string) {
  const day = new Date().toISOString().slice(0, 10);
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `photos/${day}/${id}.${ext}`;
}

async function fetchQiniuToken(): Promise<QiniuToken | null> {
  try {
    const { data } = await request.get<ApiResponse<QiniuToken>>('/upload/qiniu-token', {
      timeout: 10000,
    });
    const payload = data.data;
    if (!payload?.token || !payload.domain || !payload.uploadUrl) return null;
    return {
      token: payload.token,
      domain: payload.domain.replace(/\/$/, ''),
      uploadUrl: payload.uploadUrl,
      bucket: payload.bucket,
    };
  } catch {
    return null;
  }
}

/** 浏览器直传七牛，避免大图绕行 Vercel 函数。 */
async function uploadDirectToQiniu(file: File, tokenInfo: QiniuToken) {
  const ext = file.type.includes('png')
    ? 'png'
    : file.type.includes('webp')
      ? 'webp'
      : 'jpg';
  const key = objectKey(ext);
  const form = new FormData();
  form.append('token', tokenInfo.token);
  form.append('key', key);
  form.append('file', file);

  const resp = await fetch(tokenInfo.uploadUrl, {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`直传失败: ${resp.status} ${text}`);
  }
  return {
    url: `${tokenInfo.domain}/${key}`,
    objectName: key,
  };
}

/** 上传图片（模板样本图、巡检原图等）：先压缩，优先直传七牛。 */
export async function uploadImage(
  file: File,
  meta?: { siteName?: string; serialNumber?: string },
) {
  const compressed = await compressImageForUpload(file);
  const tokenInfo = await fetchQiniuToken();
  if (tokenInfo) {
    try {
      return await uploadDirectToQiniu(compressed, tokenInfo);
    } catch {
      // 直传失败时回退服务端中转
    }
  }

  const form = new FormData();
  form.append('file', compressed);
  if (meta?.siteName) form.append('siteName', meta.siteName);
  if (meta?.serialNumber) form.append('serialNumber', meta.serialNumber);
  const { data } = await request.post<
    ApiResponse<{ url: string; objectName: string }>
  >('/upload/photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return data.data;
}
