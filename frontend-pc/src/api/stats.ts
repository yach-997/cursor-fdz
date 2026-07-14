import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface DashboardData {
  sites: number;
  siteMarkers?: Array<{
    id: string;
    name: string;
    city: string;
    province: string;
    latitude: number;
    longitude: number;
    deviceCount: number;
  }>;
  devices: number;
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    submitted: number;
    approved: number;
    rejected: number;
  };
  records: { total: number; submitted: number; approved: number };
  pendingAudit: number;
  recentPending: Array<{
    id: string;
    taskName?: string;
    deviceType: string;
    submittedAt?: string;
  }>;
  trend: Array<{ date: string; created: number; approved: number }>;
}

export interface CompletionStats {
  totalTasks: number;
  completedTasks: number;
  submittedTasks: number;
  inProgressTasks: number;
  completionRate: number;
  byDate: Array<{ date: string; total: number; completed: number }>;
}

export interface DefectStats {
  totalInspections: number;
  totalEntries: number;
  failCount: number;
  failRate: number;
  byDeviceType: Array<{
    deviceType: string;
    total: number;
    fail: number;
    failRate: number;
  }>;
  byEntry: Array<{ name: string; failCount: number }>;
  inspectorRanking: Array<{
    inspectorId: string;
    realName: string;
    total: number;
    pass: number;
    fail: number;
    passRate: number;
  }>;
}

export async function fetchAdminDashboard() {
  const { data } = await request.get<ApiResponse<DashboardData>>('/dashboard/admin');
  return data.data;
}

export async function fetchSiteDashboard(siteId?: string) {
  const { data } = await request.get<ApiResponse<DashboardData>>('/dashboard/site', {
    params: siteId ? { siteId } : {},
  });
  return data.data;
}

export async function fetchCompletionStats(params: Record<string, string | undefined>) {
  const { data } = await request.get<ApiResponse<CompletionStats>>('/stats/completion', {
    params,
  });
  return data.data;
}

export async function fetchDefectStats(params: Record<string, string | undefined>) {
  const { data } = await request.get<ApiResponse<DefectStats>>('/stats/defects', { params });
  return data.data;
}

export async function downloadRecordsExport(params: Record<string, string | undefined>) {
  const response = await request.get('/reports/export', {
    params,
    responseType: 'blob',
  });
  const blob = response.data as Blob;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `巡检记录_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
}
