import request from '../utils/request';
import type { ApiResponse, Paginated } from '../types';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'archived';

export interface TaskItem {
  id: string;
  siteId: string;
  deviceId: string;
  taskName: string;
  inspectorId: string;
  status: TaskStatus;
  statusLabel?: string;
  startedAt?: string;
  aiEnabled: boolean;
  createdAt: string;
  site?: {
    id: string;
    name: string;
    code: string;
    province?: string;
    city?: string;
    district?: string;
    region?: string;
  };
  device?: {
    id: string;
    serialNumber: string;
    deviceType: string;
    model?: string;
  };
  inspector?: { id: string; realName: string; phone: string };
  templateSnapshot?: unknown[];
  record?: {
    id: string;
    status: string;
    rejectReason?: { reason: string };
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

export async function createTask(payload: Record<string, unknown>) {
  const { data } = await request.post<ApiResponse<TaskItem>>('/tasks', payload);
  return data.data;
}

export async function updateTask(id: string, payload: Record<string, unknown>) {
  const { data } = await request.put<ApiResponse<TaskItem>>(`/tasks/${id}`, payload);
  return data.data;
}

export async function startTask(id: string) {
  const { data } = await request.put<ApiResponse<TaskItem>>(`/tasks/${id}/start`);
  return data.data;
}

export async function cancelTask(id: string) {
  const { data } = await request.put(`/tasks/${id}/cancel`);
  return data.data;
}

/** 删除未完成任务 */
export async function deleteTask(id: string) {
  const { data } = await request.put<ApiResponse<{ success: boolean }>>(
    `/tasks/${id}/remove`,
  );
  return data.data;
}

export async function reassignTask(id: string, inspectorId: string) {
  const { data } = await request.put(`/tasks/${id}/reassign`, { inspectorId });
  return data.data;
}
