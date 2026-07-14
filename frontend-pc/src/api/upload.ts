import request from '../utils/request';
import type { ApiResponse } from '../types';

/** 上传图片（模板样本图等，可选站点名写入水印） */
export async function uploadImage(
  file: File,
  meta?: { siteName?: string; serialNumber?: string },
) {
  const form = new FormData();
  form.append('file', file);
  if (meta?.siteName) form.append('siteName', meta.siteName);
  if (meta?.serialNumber) form.append('serialNumber', meta.serialNumber);
  const { data } = await request.post<
    ApiResponse<{ url: string; objectName: string }>
  >('/upload/photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data;
}
