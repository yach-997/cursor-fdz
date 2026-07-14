import type { MenuConfig, UserRole } from '../types';

/**
 * 按角色动态菜单配置
 * super_admin / site_manager 可见对应菜单；inspector 主要使用 H5
 */
export const menuConfig: MenuConfig[] = [
  {
    key: 'dashboard',
    path: '/dashboard',
    label: '仪表盘',
    icon: 'DashboardOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'sites',
    path: '/sites',
    label: '站点管理',
    icon: 'EnvironmentOutlined',
    roles: ['super_admin'],
  },
  {
    key: 'users',
    path: '/users',
    label: '用户管理',
    icon: 'TeamOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'devices',
    path: '/devices',
    label: '设备管理',
    icon: 'ClusterOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'templates',
    path: '/templates',
    label: '模板配置',
    icon: 'FileTextOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'tasks',
    path: '/tasks',
    label: '任务管理',
    icon: 'ScheduleOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'records',
    path: '/records',
    label: '历史查询',
    icon: 'HistoryOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'audit',
    path: '/audit',
    label: '报告审核',
    icon: 'AuditOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'analysis',
    path: '/analysis',
    label: '数据分析',
    icon: 'BarChartOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'alerts',
    path: '/alerts',
    label: '预警中心',
    icon: 'AlertOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'settings',
    path: '/settings',
    label: '系统设置',
    icon: 'SettingOutlined',
    roles: ['super_admin', 'site_manager', 'inspector'],
  },
];

/** 根据角色过滤菜单 */
export function getMenusByRole(role: UserRole): MenuConfig[] {
  return menuConfig.filter((m) => m.roles.includes(role));
}

/** 登录后按角色跳转首页 */
export function getHomePathByRole(role: UserRole): string {
  if (role === 'inspector') {
    return '/settings';
  }
  return '/dashboard';
}
