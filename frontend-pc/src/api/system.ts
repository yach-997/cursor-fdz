import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface SystemStatus {
  overall: 'healthy' | 'warning' | 'error';
  checkedAt: string;
  services: Array<{
    key: string;
    name: string;
    status: 'healthy' | 'warning' | 'error';
    detail: string;
  }>;
  metrics: {
    aiFailures24h: number;
    dataRetentionMonths: number;
    monitoring: string;
  };
  support: {
    servicePeriod: string;
    workdayResponseHours: number;
    holidayMajorResponseHours: number;
    scope: string[];
  };
}

export interface SystemBranding {
  systemName: string;
  subtitle: string | null;
  logoUrl: string | null;
  updatedAt?: string | null;
}

export async function fetchSystemStatus() {
  const { data } = await request.get<ApiResponse<SystemStatus>>('/system/status', {
    skipErrorToast: true,
  } as import('../utils/request').AppAxiosRequestConfig);
  return data.data;
}

export async function fetchSystemBranding() {
  const { data } = await request.get<ApiResponse<SystemBranding>>('/system/branding', {
    skipErrorToast: true,
  } as import('../utils/request').AppAxiosRequestConfig);
  return data.data;
}

export async function updateSystemBranding(payload: {
  systemName?: string;
  subtitle?: string | null;
  logoUrl?: string | null;
}) {
  const { data } = await request.put<ApiResponse<SystemBranding>>('/system/branding', payload);
  return data.data;
}
