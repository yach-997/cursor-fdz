import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Toast } from 'react-vant';
import type { ApiResponse } from '../types';

/** 线上可设 VITE_API_BASE=https://your-api.example.com/api */
const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api';

const request = axios.create({
  baseURL: apiBase,
  timeout: 30000,
});

request.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function isAuthLoginRequest(url?: string) {
  return !!url && (url.includes('/auth/login') || url.endsWith('/login'));
}

request.interceptors.response.use(
  (response) => {
    const res = response.data as ApiResponse;
    if (res.code && res.code !== 200) {
      if (res.code === 401) {
        // 登录接口 401 = 账号密码错误，只提示、不刷新页面
        if (isAuthLoginRequest(response.config.url)) {
          Toast.info(res.message || '用户名或密码错误');
          return Promise.reject(new Error(res.message || '登录失败'));
        }
        clearAuth();
        window.location.href = '/m/login';
        return Promise.reject(new Error(res.message || '未登录'));
      }
      Toast.info(res.message || '请求失败');
      return Promise.reject(new Error(res.message || '请求失败'));
    }
    return response;
  },
  (error: AxiosError<ApiResponse>) => {
    const status = error.response?.status;
    const msg = error.response?.data?.message || error.message;
    const reqUrl = error.config?.url;
    if (status === 401) {
      if (isAuthLoginRequest(reqUrl)) {
        Toast.info(msg || '用户名或密码错误');
        return Promise.reject(error);
      }
      clearAuth();
      Toast.info('登录已过期');
      window.location.href = '/m/login';
    } else if (status === 403 && isAuthLoginRequest(reqUrl)) {
      Toast.info(msg || '无权限登录巡检端');
      return Promise.reject(error);
    } else {
      Toast.info(msg || '网络错误');
    }
    return Promise.reject(error);
  },
);

function clearAuth() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('userInfo');
}

export default request;
