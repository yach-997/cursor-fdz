import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Toast } from 'react-vant';
import type { ApiResponse } from '../types';

/**
 * 本地默认 /api（Vite 代理 Nest）
 * 线上 Supabase Edge：VITE_API_BASE=https://xxxx.supabase.co/functions/v1/api
 */
const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api';
const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

const request = axios.create({
  baseURL: apiBase,
  timeout: 30000,
});

request.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (config.headers) {
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // 调用 Supabase Edge 时网关需要 apikey
    if (supabaseAnon && apiBase.includes('supabase.co')) {
      config.headers.apikey = supabaseAnon;
    }
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
