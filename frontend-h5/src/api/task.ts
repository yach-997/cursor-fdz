import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface Paginated<T> {
  list: T[];
  total: number;
  page: number;
  limit: number;
}

export interface TaskItem {
  id: string;
  siteId: string;
  deviceId: string;
  taskName: string;
  status: string;
  statusLabel?: string;
  startedAt?: string;
  createdAt?: string;
  site?: {
    id: string;
    name: string;
    code: string;
    province?: string;
    city?: string;
    region?: string;
  };
  device?: { id: string; serialNumber: string; deviceType: string; model?: string };
  inspector?: { id: string; realName: string };
  aiEnabled?: boolean;
  templateSnapshot?: Array<{
    id: string;
    name: string;
    description: string;
    isRequired: boolean;
    samplePhotos?: string[];
    isOptionalModule?: boolean;
  }>;
  record?: {
    id: string;
    status: string;
    entries?: unknown[];
    rejectReason?: { reason: string; entryIds?: string[]; rejectedAt?: string };
  } | null;
}

export async function fetchTasks(params: Record<string, unknown>) {
  const { data } = await request.get<ApiResponse<Paginated<TaskItem>>>('/tasks', { params });
  return data.data;
}

export async function fetchTask(id: string) {
  const { data } = await request.get<ApiResponse<TaskItem>>(`/tasks/${id}`);
  return data.data;
}

export async function startTask(id: string) {
  const { data } = await request.put<ApiResponse<TaskItem>>(`/tasks/${id}/start`);
  return data.data;
}

export async function createTask(payload: {
  taskName: string;
  siteId: string;
  deviceId?: string;
  serialNumber?: string;
  aiEnabled?: boolean;
}) {
  const { data } = await request.post<ApiResponse<TaskItem>>('/tasks', payload);
  return data.data;
}

/** 删除未完成任务 */
export async function deleteTask(id: string) {
  const { data } = await request.put<ApiResponse<{ success: boolean }>>(
    `/tasks/${id}/remove`,
  );
  return data.data;
}
