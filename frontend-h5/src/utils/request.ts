import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { Toast } from 'react-vant';
import type { ApiResponse } from '../types';

/**
 * 模式 A（本地）：VITE_API_BASE 空 → /api 代理 Nest
 * 模式 B（Supabase RPC）：配置 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
 * 模式 C（Edge/其他）：仅配置 VITE_API_BASE
 */
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') || '';
const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';
const useRpc = !!(supabaseUrl && supabaseAnon);
const apiBase =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ||
  (useRpc ? `${supabaseUrl}/rest/v1` : '/api');

const request = axios.create({
  baseURL: apiBase,
  timeout: 30000,
});

function wrapOk<T>(data: T): { data: ApiResponse<T> } {
  return { data: { code: 200, message: 'success', data } };
}

function tokenOf() {
  return localStorage.getItem('accessToken') || '';
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: ApiResponse<T> }> {
  const { data, status } = await axios.post(`${supabaseUrl}/rest/v1/rpc/${fn}`, args, {
    headers: {
      apikey: supabaseAnon,
      Authorization: `Bearer ${supabaseAnon}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (status >= 400) {
    const msg = (data as { message?: string })?.message || '请求失败';
    const code = String((data as { code?: string })?.code || '');
    const http = code === '42501' ? 403 : code === '28000' ? 401 : status;
    throw Object.assign(new Error(msg), {
      response: { status: http, data: { code: http, message: msg, data: null } },
    });
  }
  if (typeof data === 'object' && data !== null && 'code' in data && 'message' in data) {
    // PostgREST error shape
    const msg = (data as { message?: string }).message || '请求失败';
    throw Object.assign(new Error(msg), {
      response: { status: 400, data: { code: 400, message: msg, data: null } },
    });
  }
  return wrapOk(data as T);
}

async function dispatchRpc(config: AxiosRequestConfig) {
  const method = (config.method || 'get').toLowerCase();
  const url = (config.url || '').replace(/^\//, '');
  const params = (config.params || {}) as Record<string, unknown>;
  const body = (config.data || {}) as Record<string, unknown>;
  const tok = tokenOf();

  if (method === 'post' && url === 'auth/login') {
    return rpc('app_login', {
      p_username: body.username,
      p_password: body.password,
      p_client: body.client || 'h5',
    });
  }
  if (method === 'get' && url === 'auth/me') {
    return rpc('app_me', { p_token: tok });
  }
  if (method === 'get' && url === 'health') {
    return rpc('app_health', {});
  }
  if (method === 'get' && url === 'sites') {
    return rpc('app_sites_list', { p_token: tok });
  }
  if (method === 'get' && url === 'devices') {
    return rpc('app_devices_list', {
      p_token: tok,
      p_site_id: params.siteId || null,
    });
  }
  if (method === 'get' && url === 'tasks') {
    return rpc('app_tasks_list', {
      p_token: tok,
      p_page: Number(params.page || 1),
      p_limit: Number(params.limit || 20),
      p_site_id: params.siteId || null,
      p_status: params.status || null,
    });
  }
  if (method === 'post' && url === 'tasks') {
    return rpc('app_task_create', { p_token: tok, p_body: body });
  }
  if (method === 'get' && url.startsWith('tasks/')) {
    const id = url.slice('tasks/'.length).split('/')[0];
    return rpc('app_task_get', { p_token: tok, p_id: id });
  }

  Toast.info('该功能需要配置完整后端 API');
  return Promise.reject(new Error(`RPC 未实现: ${method.toUpperCase()} /${url}`));
}

request.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (useRpc && !apiBase.includes('functions/v1')) {
    // 走 RPC 时拦截真实发送
    const adapterResult = await dispatchRpc(config);
    config.adapter = async () =>
      ({
        data: adapterResult.data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }) as never;
    return config;
  }

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

request.interceptors.response.use(
  (response) => {
    const res = response.data as ApiResponse;
    if (res.code && res.code !== 200) {
      if (res.code === 401) {
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
