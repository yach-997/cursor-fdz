import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface Paginated<T> {
  list: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AlertItem {
  id: string;
  siteId: string;
  siteName?: string;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface AlertConfigItem {
  id: string;
  siteId: string;
  failRateThreshold: number;
  passRateThreshold: number;
  overdueDays: number;
  enabled: boolean;
  notifyEmails?: string[] | null;
  webhookUrl?: string | null;
}

export async function fetchAlerts(params: Record<string, unknown>) {
  const { data } = await request.get<ApiResponse<Paginated<AlertItem>>>('/alerts', { params });
  return data.data;
}

export async function fetchAlertConfigs(siteId?: string) {
  const { data } = await request.get<ApiResponse<{ list: AlertConfigItem[] }>>(
    '/alerts/config/list',
    { params: siteId ? { siteId } : {} },
  );
  return data.data.list;
}

export async function saveAlertConfig(payload: {
  siteId: string;
  passRateThreshold?: number;
  overdueDays?: number;
  enabled?: boolean;
  notifyEmails?: string[];
  webhookUrl?: string;
}) {
  const { data } = await request.post<ApiResponse<AlertConfigItem>>('/alerts/config', payload);
  return data.data;
}

export async function resolveAlert(id: string) {
  const { data } = await request.put<ApiResponse<AlertItem>>(`/alerts/${id}/resolve`);
  return data.data;
}
