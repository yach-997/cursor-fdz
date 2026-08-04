import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Dropdown, Avatar, Drawer, Button, Grid } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  EnvironmentOutlined,
  TeamOutlined,
  ClusterOutlined,
  FileTextOutlined,
  ScheduleOutlined,
  HistoryOutlined,
  AuditOutlined,
  BarChartOutlined,
  AlertOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AccountBookOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/auth';
import { flattenMenus, getMenusByRole } from '../router/menus';
import type { MenuConfig } from '../types';
import './basic-layout.css';

const { Header, Sider, Content } = Layout;

const iconMap: Record<string, React.ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  EnvironmentOutlined: <EnvironmentOutlined />,
  TeamOutlined: <TeamOutlined />,
  ClusterOutlined: <ClusterOutlined />,
  FileTextOutlined: <FileTextOutlined />,
  ScheduleOutlined: <ScheduleOutlined />,
  HistoryOutlined: <HistoryOutlined />,
  AuditOutlined: <AuditOutlined />,
  BarChartOutlined: <BarChartOutlined />,
  AlertOutlined: <AlertOutlined />,
  SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  SettingOutlined: <SettingOutlined />,
  AccountBookOutlined: <AccountBookOutlined />,
};

const roleLabel: Record<string, string> = {
  super_admin: '超级管理员',
  site_manager: '网格长',
  inspector: '工程师',
};

function toMenuItems(items: MenuConfig[]): MenuProps['items'] {
  return items.map((m) => {
    if (m.children?.length) {
      return {
        key: m.key,
        icon: m.icon ? iconMap[m.icon] : null,
        label: m.label,
        children: toMenuItems(m.children),
      };
    }
    return {
      key: m.path,
      icon: m.icon ? iconMap[m.icon] : null,
      label: m.label,
    };
  });
}

/** 主布局：左侧动态菜单 + 顶部用户信息 */
export default function BasicLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const menuTree = useMemo(() => (user ? getMenusByRole(user.role) : []), [user]);
  const leafMenus = useMemo(() => flattenMenus(menuTree), [menuTree]);
  const menus = useMemo(() => toMenuItems(menuTree), [menuTree]);

  const selectedKeys = useMemo(() => {
    const match = leafMenus
      .filter((m) => location.pathname === m.path || location.pathname.startsWith(`${m.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return match ? [match.path] : [];
  }, [location.pathname, leafMenus]);

  const currentTitle = useMemo(() => {
    const leaf = leafMenus.find((m) => selectedKeys.includes(m.path));
    if (leaf) return leaf.label;
    const group = menuTree.find((m) => location.pathname.startsWith(m.path));
    return group?.label || '工作台';
  }, [leafMenus, selectedKeys, menuTree, location.pathname]);

  // 进入费用结算子页时自动展开分组
  useEffect(() => {
    if (location.pathname.startsWith('/finance')) {
      setOpenKeys((prev) => (prev.includes('finance') ? prev : [...prev, 'finance']));
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!user) return;
    if (
      user.role === 'inspector' &&
      (location.pathname.startsWith('/finance') ||
        location.pathname === '/dashboard' ||
        location.pathname === '/sites' ||
        location.pathname === '/users')
    ) {
      navigate('/settings', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const menuNode = (
    <>
      <div className="app-brand">
        <div className="app-brand__mark">光</div>
        {(!collapsed || isMobile) && (
          <div className="app-brand__text">
            <div className="app-brand__title">光伏储能巡检</div>
            <div className="app-brand__sub">智能巡检平台</div>
          </div>
        )}
      </div>
      <Menu
        className="app-menu"
        theme="dark"
        mode="inline"
        selectedKeys={selectedKeys}
        openKeys={collapsed && !isMobile ? [] : openKeys}
        onOpenChange={(keys) => setOpenKeys(keys as string[])}
        items={menus}
        onClick={({ key }) => {
          if (String(key).startsWith('/')) {
            navigate(key);
            setMobileMenuOpen(false);
          }
        }}
      />
    </>
  );

  return (
    <Layout className="app-shell">
      {!isMobile && (
        <Sider
          className="app-sider"
          collapsed={collapsed}
          trigger={null}
          width={232}
          collapsedWidth={76}
        >
          {menuNode}
        </Sider>
      )}
      <Drawer
        className="mobile-drawer"
        open={isMobile && mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        placement="left"
        width={268}
        closable={false}
      >
        {menuNode}
      </Drawer>
      <Layout className="app-main">
        <Header className="app-header">
          <div className="app-header__left">
            <Button
              type="text"
              className="app-menu-toggle"
              icon={isMobile || collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => (isMobile ? setMobileMenuOpen(true) : setCollapsed(!collapsed))}
            />
            <div>
              <h1 className="app-page-title">{currentTitle}</h1>
              <div className="app-page-subtitle">光伏储能智能巡检工作台</div>
            </div>
          </div>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'settings',
                  icon: <SettingOutlined />,
                  label: '系统设置',
                  onClick: () => navigate('/settings'),
                },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: handleLogout,
                },
              ],
            }}
          >
            <div className="app-user">
              <Avatar className="app-user__avatar" icon={<UserOutlined />} src={user?.avatar} />
              <div className="app-user__meta">
                <div className="app-user__name">{user?.realName}</div>
                <div className="app-user__role">{roleLabel[user?.role || ''] || '未知角色'}</div>
              </div>
            </div>
          </Dropdown>
        </Header>
        <Content className="app-content">
          <div className="app-content__surface">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
