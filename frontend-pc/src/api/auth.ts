import request from '../utils/request';
import type { ApiResponse, LoginResult, UserInfo } from '../types';

/** 登录（PC 管理端） */
export async function loginApi(username: string, password: string) {
  const { data } = await request.post<ApiResponse<LoginResult>>('/auth/login', {
    username,
    password,
    client: 'pc',
  });
  return data.data;
}

/** 登出 */
export async function logoutApi() {
  const { data } = await request.post<ApiResponse<{ success: boolean }>>('/auth/logout');
  return data.data;
}

/** 当前用户 */
export async function getMeApi() {
  const { data } = await request.get<ApiResponse<UserInfo>>('/auth/me');
  return data.data;
}

/** 刷新令牌 */
export async function refreshTokenApi(refreshToken: string) {
  const { data } = await request.post<ApiResponse<{ accessToken: string }>>('/auth/refresh', {
    refreshToken,
  });
  return data.data;
}

/** 更新个人资料 */
export async function updateProfileApi(payload: {
  realName?: string;
  phone?: string;
  email?: string;
  region?: string;
  avatar?: string;
}) {
  const { data } = await request.put<ApiResponse<UserInfo>>('/auth/profile', payload);
  return data.data;
}

/** 修改密码 */
export async function changePasswordApi(oldPassword: string, newPassword: string) {
  const { data } = await request.put<ApiResponse<{ success: boolean }>>(
    '/auth/change-password',
    { oldPassword, newPassword },
  );
  return data.data;
}
