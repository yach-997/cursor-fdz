import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Tabbar } from 'react-vant';
import { useMemo } from 'react';

/** 底部 Tab 导航布局（首页 / 任务 / 我的） */
export default function TabLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const active = useMemo(() => {
    if (location.pathname.startsWith('/m/tasks')) return '/m/tasks';
    if (location.pathname.startsWith('/m/my')) return '/m/my';
    return '/m';
  }, [location.pathname]);

  // 详情页等不显示底部导航
  const hideTab =
    location.pathname.includes('/inspection/') ||
    location.pathname.includes('/photo') ||
    location.pathname.includes('/success') ||
    /\/m\/tasks\/[^/]+$/.test(location.pathname);

  return (
    <div className="tab-layout">
      <div className="tab-layout__content">
        <Outlet />
      </div>
      {!hideTab && (
        <Tabbar
          value={active}
          onChange={(v) => navigate(String(v))}
          safeAreaInsetBottom
          fixed
          placeholder
        >
          <Tabbar.Item name="/m" icon="home-o">
            首页
          </Tabbar.Item>
          <Tabbar.Item name="/m/tasks" icon="orders-o">
            任务
          </Tabbar.Item>
          <Tabbar.Item name="/m/my" icon="user-o">
            我的
          </Tabbar.Item>
        </Tabbar>
      )}
    </div>
  );
}
