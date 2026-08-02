import type { MenuConfig, UserRole } from '../types';

/**
 * 侧栏菜单（主流程：费用案例派工 → 巡检 → 结算）
 * 已下线入口不出现在菜单：旧仪表盘 / 任务管理 / 数据分析 / 预警 / 运维监控
 * （路由仍保留或重定向，避免书签 404）
 */
export const menuConfig: MenuConfig[] = [
  {
    key: 'finance',
    path: '/finance',
    label: '费用结算中心',
    icon: 'AccountBookOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'sites',
    path: '/sites',
    label: '站点管理',
    icon: 'EnvironmentOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'users',
    path: '/users',
    label: '用户管理',
    icon: 'TeamOutlined',
    roles: ['super_admin', 'site_manager'],
  },
  {
    key: 'templates',
    path: '/templates',
    label: '任务类型',
    icon: 'FileTextOutlined',
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
  return '/finance/cases';
}
