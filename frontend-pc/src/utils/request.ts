import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
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

/** 请求拦截：附加 JWT / Supabase apikey */
request.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (config.headers) {
    if (token) config.headers.Authorization = `Bearer ${token}`;
    if (supabaseAnon && apiBase.includes('supabase.co')) {
      config.headers.apikey = supabaseAnon;
    }
  }
  return config;
});

function isAuthLoginRequest(url?: string) {
  return !!url && (url.includes('/auth/login') || url.endsWith('/login'));
}

/** 响应拦截：统一错误处理 */
request.interceptors.response.use(
  (response) => {
    // 文件下载等二进制响应直接返回
    if (response.config.responseType === 'blob') {
      return response;
    }
    const res = response.data as ApiResponse;
    // 业务错误码
    if (res.code && res.code !== 200) {
      if (res.code === 401) {
        // 登录接口的 401 = 账号密码错误，只提示、不整页跳转
        if (isAuthLoginRequest(response.config.url)) {
          message.error(res.message || '用户名或密码错误');
          return Promise.reject(new Error(res.message || '登录失败'));
        }
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('userInfo');
        window.location.href = '/login';
        return Promise.reject(new Error(res.message || '未登录'));
      }
      if (res.code === 403) {
        // 登录时无端权限只提示，不跳转 403 页
        if (isAuthLoginRequest(response.config.url)) {
          message.error(res.message || '无权限登录该端');
          return Promise.reject(new Error(res.message || '无权限'));
        }
        message.error(res.message || '无权限');
        window.location.href = '/403';
        return Promise.reject(new Error(res.message || '无权限'));
      }
      message.error(res.message || '请求失败');
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
        message.error(msg || '用户名或密码错误');
        return Promise.reject(error);
      }
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('userInfo');
      message.error('登录已过期，请重新登录');
      window.location.href = '/login';
    } else if (status === 403) {
      if (isAuthLoginRequest(reqUrl)) {
        message.error(msg || '无权限登录该端');
        return Promise.reject(error);
      }
      message.error(msg || '无权限访问');
      window.location.href = '/403';
    } else {
      message.error(msg || '网络错误');
    }
    return Promise.reject(error);
  },
);

export default request;
