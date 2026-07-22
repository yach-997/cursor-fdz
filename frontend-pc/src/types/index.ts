export type UserRole = 'super_admin' | 'site_manager' | 'inspector';
export type CommonStatus = 'active' | 'inactive';
export type DeviceType = 'string_inverter' | 'central_inverter' | 'energy_storage';
export type DeviceStatus = 'active' | 'inactive' | 'maintenance';

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface Paginated<T> {
  list: T[];
  total: number;
  page: number;
  limit: number;
}

export interface UserInfo {
  id: string;
  username: string;
  realName: string;
  phone: string;
  email?: string;
  avatar?: string;
  /** 本次登录生效角色 */
  role: UserRole;
  /** 账号具备的全部角色 */
  roles?: UserRole[];
  status: string;
  region?: string;
  orgUnit?: string;
  managedSites?: SiteBrief[];
  siteMemberships?: SiteMembership[];
  membershipCount?: number;
  createdAt?: string;
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

export interface SiteItem {
  id: string;
  name: string;
  code: string;
  province: string;
  city: string;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  inspectionRadiusMeters: number;
  managerId: string | null;
  status: CommonStatus;
  createdAt: string;
  manager?: {
    id: string;
    username: string;
    realName: string;
    phone: string;
  } | null;
}

export interface DeviceItem {
  id: string;
  siteId: string;
  serialNumber: string;
  deviceType: DeviceType;
  model?: string;
  manufacturer?: string;
  installDate?: string;
  status: DeviceStatus;
  createdAt: string;
  site?: SiteBrief;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: UserInfo;
}

export interface MenuConfig {
  key: string;
  path: string;
  label: string;
  icon?: string;
  roles: UserRole[];
}

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  string_inverter: '组串式逆变器',
  central_inverter: '集中式逆变器',
  energy_storage: '储能系统',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: '超级管理员',
  site_manager: '站长',
  inspector: '工程师',
};
