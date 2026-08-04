import type { MenuConfig, UserRole } from '../types';

/**
 * 侧栏菜单（主流程：费用案例派工 → 巡检 → 结算）
 * 费用结算拆为可展开分组，子功能直接落在侧栏。
 */
export const menuConfig: MenuConfig[] = [
  {
    key: 'finance',
    path: '/finance',
    label: '费用结算',
    icon: 'AccountBookOutlined',
    roles: ['super_admin', 'site_manager'],
    children: [
      {
        key: 'finance-dashboard',
        path: '/finance/dashboard',
        label: '经营看板',
        icon: 'BarChartOutlined',
        roles: ['super_admin', 'site_manager'],
      },
      {
        key: 'finance-cases',
        path: '/finance/cases',
        label: '案例管理',
        icon: 'FileTextOutlined',
        roles: ['super_admin', 'site_manager'],
      },
      {
        key: 'finance-po',
        path: '/finance/po-orders',
        label: 'PO 管理',
        icon: 'ScheduleOutlined',
        roles: ['super_admin', 'site_manager'],
      },
      {
        key: 'finance-prices',
        path: '/finance/prices',
        label: '价格库',
        icon: 'AccountBookOutlined',
        roles: ['super_admin', 'site_manager'],
      },
      {
        key: 'finance-review',
        path: '/finance/review',
        label: '结算审核',
        icon: 'AuditOutlined',
        roles: ['super_admin', 'site_manager'],
      },
      {
        key: 'finance-assessment',
        path: '/finance/assessment',
        label: '考核管理',
        icon: 'SafetyCertificateOutlined',
        roles: ['super_admin', 'site_manager'],
      },
      {
        key: 'finance-monthly',
        path: '/finance/monthly',
        label: '月度结算',
        icon: 'HistoryOutlined',
        roles: ['super_admin', 'site_manager'],
      },
    ],
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
    key: 'hard-rules',
    path: '/hard-rules',
    label: 'AI 硬规则',
    icon: 'SafetyCertificateOutlined',
    roles: ['super_admin'],
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

function filterMenuByRole(items: MenuConfig[], role: UserRole): MenuConfig[] {
  return items
    .filter((m) => m.roles.includes(role))
    .map((m) => ({
      ...m,
      children: m.children ? filterMenuByRole(m.children, role) : undefined,
    }))
    .filter((m) => !m.children || m.children.length > 0);
}

/** 根据角色过滤菜单 */
export function getMenusByRole(role: UserRole): MenuConfig[] {
  return filterMenuByRole(menuConfig, role);
}

/** 扁平化所有可点击叶子菜单（用于选中态 / 标题） */
export function flattenMenus(items: MenuConfig[]): MenuConfig[] {
  const out: MenuConfig[] = [];
  for (const item of items) {
    if (item.children?.length) out.push(...flattenMenus(item.children));
    else out.push(item);
  }
  return out;
}

/** 登录后按角色跳转首页 */
export function getHomePathByRole(role: UserRole): string {
  if (role === 'inspector') {
    return '/settings';
  }
  return '/finance/cases';
}
