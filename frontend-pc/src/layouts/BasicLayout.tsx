import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Dropdown, Avatar, theme, Typography, Space } from 'antd';
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
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/auth';
import { getMenusByRole } from '../router/menus';

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
  SettingOutlined: <SettingOutlined />,
};

const roleLabel: Record<string, string> = {
  super_admin: '超级管理员',
  site_manager: '站长',
  inspector: '巡检员',
};

/** 主布局：左侧动态菜单 + 顶部用户信息 */
export default function BasicLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const menus = useMemo(() => {
    if (!user) return [];
    return getMenusByRole(user.role).map((m) => ({
      key: m.path,
      icon: m.icon ? iconMap[m.icon] : null,
      label: m.label,
    }));
  }, [user]);

  const selectedKeys = useMemo(() => {
    const match = menus.find((m) => location.pathname.startsWith(m.key));
    return match ? [match.key] : [];
  }, [location.pathname, menus]);

  useEffect(() => {
    if (!user) return;
    // 巡检员默认不进仪表盘
    if (user.role === 'inspector' && location.pathname === '/dashboard') {
      navigate('/settings', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} trigger={null} theme="dark" width={220}>
        <div
          style={{
            height: 56,
            margin: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 600,
            fontSize: collapsed ? 14 : 16,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {collapsed ? '巡检' : '智能设备巡检系统'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKeys}
          items={menus}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <span
            style={{ cursor: 'pointer', fontSize: 18 }}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </span>
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
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} src={user?.avatar} />
              <Typography.Text>
                {user?.realName}
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  ({roleLabel[user?.role || ''] || user?.role})
                </Typography.Text>
              </Typography.Text>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16 }}>
          <div
            style={{
              padding: 24,
              minHeight: 360,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
            }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
