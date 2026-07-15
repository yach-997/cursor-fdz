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

export async function fetchSystemStatus() {
  const { data } = await request.get<ApiResponse<SystemStatus>>('/system/status');
  return data.data;
}
