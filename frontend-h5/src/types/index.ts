/** 用户角色 */
export type UserRole = 'super_admin' | 'site_manager' | 'inspector';

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface UserInfo {
  id: string;
  username: string;
  realName: string;
  phone: string;
  email?: string;
  region?: string;
  avatar?: string;
  role: UserRole;
  roles?: UserRole[];
  status: string;
  siteMemberships?: SiteMembership[];
}

export interface SiteBrief {
  id: string;
  name: string;
  code: string;
  province?: string;
  city?: string;
}

export interface SiteMembership {
  id: string;
  siteId: string;
  status: string;
  site: SiteBrief | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: UserInfo;
}
