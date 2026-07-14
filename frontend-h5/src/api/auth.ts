import request from '../utils/request';
import type { ApiResponse, LoginResult, UserInfo } from '../types';

/** 登录（H5 巡检端） */
export async function loginApi(username: string, password: string) {
  const { data } = await request.post<ApiResponse<LoginResult>>('/auth/login', {
    username,
    password,
    client: 'h5',
  });
  return data.data;
}

export async function logoutApi() {
  const { data } = await request.post<ApiResponse<{ success: boolean }>>('/auth/logout');
  return data.data;
}

export async function getMeApi() {
  const { data } = await request.get<ApiResponse<UserInfo>>('/auth/me');
  return data.data;
}

export async function updateProfileApi(payload: {
  realName?: string;
  phone?: string;
  email?: string;
  region?: string;
}) {
  const { data } = await request.put<ApiResponse<UserInfo>>('/auth/profile', payload);
  return data.data;
}

export async function changePasswordApi(oldPassword: string, newPassword: string) {
  const { data } = await request.put<ApiResponse<{ success: boolean }>>(
    '/auth/change-password',
    { oldPassword, newPassword },
  );
  return data.data;
}
