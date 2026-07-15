import { create } from 'zustand';
import type { UserInfo, SiteBrief } from '../types';
import { loginApi, logoutApi, getMeApi } from '../api/auth';

const SITE_KEY = 'currentSite';

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  currentSite: SiteBrief | null;
  hydrated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<UserInfo>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  setCurrentSite: (site: SiteBrief) => void;
  hydrate: () => void;
}

/** H5 认证与当前站点 Store */
export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  currentSite: null,
  hydrated: false,
  loading: false,

  hydrate: () => {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('userInfo');
    const siteStr = localStorage.getItem(SITE_KEY);
    let user: UserInfo | null = null;
    let currentSite: SiteBrief | null = null;
    try {
      user = userStr ? JSON.parse(userStr) : null;
      currentSite = siteStr ? JSON.parse(siteStr) : null;
    } catch {
      localStorage.removeItem('userInfo');
      localStorage.removeItem(SITE_KEY);
    }
    set({
      token: token && user ? token : null,
      user,
      currentSite,
      hydrated: true,
    });
  },

  login: async (username, password) => {
    set({ loading: true });
    // 换号登录前先清掉旧会话，避免仍显示上一个管理员
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userInfo');
    localStorage.removeItem(SITE_KEY);
    set({ token: null, user: null, currentSite: null });
    try {
      const result = await loginApi(username, password);
      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('refreshToken', result.refreshToken);
      localStorage.setItem('userInfo', JSON.stringify(result.user));
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
      // ignore
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userInfo');
    localStorage.removeItem(SITE_KEY);
    set({ token: null, user: null, currentSite: null });
  },

  fetchMe: async () => {
    const user = await getMeApi();
    localStorage.setItem('userInfo', JSON.stringify(user));
    set({ user });
  },

  setCurrentSite: (site) => {
    localStorage.setItem(SITE_KEY, JSON.stringify(site));
    set({ currentSite: site });
  },
}));
