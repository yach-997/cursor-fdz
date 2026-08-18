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
  /** 是否对该条目做 AI；文本默认关，可勾选开 */
  aiEnabled?: boolean;
  /** @deprecated */
  entryKind?: 'check' | 'record';
  /** @deprecated */
  isOptionalModule?: boolean;
}

/** 是否启用 AI（含旧数据推断） */
export function resolveEntryAiEnabled(entry: {
  aiEnabled?: boolean;
  entryKind?: string;
  checkType?: 'photo' | 'text' | string;
}): boolean {
  if (entry.aiEnabled === true) return true;
  if (entry.aiEnabled === false) return false;
  if (entry.entryKind === 'record') return false;
  if (entry.entryKind === 'check') return true;
  if (entry.checkType === 'text') return false;
  return true;
}

/** @deprecated 请用 resolveEntryAiEnabled */
export function resolveEntryKind(entry: {
  entryKind?: string;
  checkType?: string;
  aiEnabled?: boolean;
}): 'check' | 'record' {
  return resolveEntryAiEnabled(entry) ? 'check' : 'record';
}

export interface TemplateProductLine {
  id: string;
  name: string;
  entries: TemplateEntry[];
  /** @deprecated */
  entryMode?: 'check' | 'record';
}

export interface TemplateItem {
  id: string;
  name: string;
  deviceType: DeviceType;
  entries: TemplateEntry[];
  productLines?: TemplateProductLine[];
  isGlobal: boolean;
  siteId: string | null;
  assignMode?: 'single' | 'multi';
  unitLabel?: string;
  expenseEnabledDefault?: boolean;
  version: number;
  versionChanged?: boolean;
  rematchedCases?: number;
  syncedCases?: number;
  createdAt: string;
}

export async function fetchTemplates(params?: {
  deviceType?: DeviceType;
  siteId?: string;
  keyword?: string;
}) {
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
