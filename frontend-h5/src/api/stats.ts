import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface InspectorSummary {
  month: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    submitted: number;
    completionRate: number;
  };
  recentTasks: Array<{
    id: string;
    taskName: string;
    status: string;
    siteName: string;
    deviceSerial: string;
    plannedDate?: string;
    completedAt?: string;
    createdAt: string;
  }>;
}

export async function fetchInspectorSummary(siteId?: string) {
  const { data } = await request.get<ApiResponse<InspectorSummary>>('/stats/inspector/me', {
    params: siteId ? { siteId } : {},
  });
  return data.data;
}
