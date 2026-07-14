import request from '../utils/request';
import type { ApiResponse, Paginated, UserInfo, UserRole, CommonStatus } from '../types';

export interface UserQuery {
  role?: UserRole;
  status?: CommonStatus;
  keyword?: string;
  page?: number;
  limit?: number;
}

export async function fetchUsers(params: UserQuery) {
  const { data } = await request.get<ApiResponse<Paginated<UserInfo>>>('/users', { params });
  return data.data;
}

export async function createUser(payload: Record<string, unknown>) {
  const { data } = await request.post<ApiResponse<UserInfo>>('/users', payload);
  return data.data;
}

export async function updateUser(id: string, payload: Record<string, unknown>) {
  const { data } = await request.put<ApiResponse<UserInfo>>(`/users/${id}`, payload);
  return data.data;
}

export async function updateUserStatus(id: string, status: CommonStatus) {
  const { data } = await request.put<ApiResponse<UserInfo>>(`/users/${id}/status`, { status });
  return data.data;
}

export async function resetUserPassword(id: string, newPassword: string) {
  const { data } = await request.put(`/users/${id}/reset-password`, { newPassword });
  return data.data;
}

export async function fetchInspectorPool(params: { keyword?: string; page?: number; limit?: number }) {
  const { data } = await request.get<ApiResponse<Paginated<UserInfo>>>('/users/inspectors/pool', {
    params,
  });
  return data.data;
}
