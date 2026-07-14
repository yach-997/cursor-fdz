import { create } from 'zustand';
import type { UserInfo } from '../types';
import { loginApi, logoutApi, getMeApi } from '../api/auth';

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  loading: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<UserInfo>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  hydrate: () => void;
}

/** 认证状态 Store */
export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  loading: false,

  hydrate: () => {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('userInfo');
    if (token && userStr) {
      try {
        set({ token, user: JSON.parse(userStr) });
      } catch {
        localStorage.removeItem('userInfo');
      }
    }
  },

  login: async (username, password, remember = false) => {
    set({ loading: true });
    // 换号登录前先清掉旧会话，避免仍显示上一个管理员
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userInfo');
    set({ token: null, user: null });
    try {
      const result = await loginApi(username, password);
      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('refreshToken', result.refreshToken);
      localStorage.setItem('userInfo', JSON.stringify(result.user));

      if (remember) {
        localStorage.setItem('rememberedUsername', username);
      } else {
        localStorage.removeItem('rememberedUsername');
      }

      set({ token: result.accessToken, user: result.user, loading: false });
      return result.user;
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  logout: async () => {
    try {
      await logoutApi();
    } catch {
      // 忽略登出接口错误
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userInfo');
    set({ token: null, user: null });
  },

  fetchMe: async () => {
    const user = await getMeApi();
    localStorage.setItem('userInfo', JSON.stringify(user));
    set({ user });
  },
}));
