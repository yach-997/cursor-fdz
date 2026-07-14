import request from '../utils/request';
import type { ApiResponse, DeviceType } from '../types';

export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  isRequired: boolean;
  order: number;
  samplePhotos: string[];
  checkType: 'photo' | 'text';
  isOptionalModule?: boolean;
}

export interface TemplateItem {
  id: string;
  name: string;
  deviceType: DeviceType;
  entries: TemplateEntry[];
  isGlobal: boolean;
  siteId: string | null;
  version: number;
  createdAt: string;
}

export async function fetchTemplates(params?: { deviceType?: DeviceType; siteId?: string }) {
  const { data } = await request.get<ApiResponse<TemplateItem[]>>('/templates', { params });
  return data.data;
}

export async function createTemplate(payload: Record<string, unknown>) {
  const { data } = await request.post<ApiResponse<TemplateItem>>('/templates', payload);
  return data.data;
}

export async function updateTemplate(id: string, payload: Record<string, unknown>) {
  const { data } = await request.put<ApiResponse<TemplateItem>>(`/templates/${id}`, payload);
  return data.data;
}

export async function deleteTemplate(id: string) {
  const { data } = await request.delete(`/templates/${id}`);
  return data.data;
}

export async function cloneTemplate(id: string, siteId: string) {
  const { data } = await request.post<ApiResponse<TemplateItem>>(`/templates/${id}/clone`, {
    siteId,
  });
  return data.data;
}
