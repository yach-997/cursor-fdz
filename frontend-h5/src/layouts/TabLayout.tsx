import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Tabbar } from 'react-vant';
import { HomeO, OrdersO, UserO } from '@react-vant/icons';
import { useEffect, useLayoutEffect, useMemo, type ComponentType } from 'react';
import { useAuthStore } from '../stores/auth';
import { fetchTasks } from '../api/task';
import { fetchInspectorSummary } from '../api/stats';
import { mobileCacheKeys } from '../utils/mobileCacheKeys';
import { prefetchResource } from '../utils/useCachedResource';

// @react-vant/icons 的旧类型声明与当前 React 类型不兼容，运行时组件正常。
const HomeIcon = HomeO as unknown as ComponentType;
const TasksIcon = OrdersO as unknown as ComponentType;
const UserIcon = UserO as unknown as ComponentType;

/** 底部 Tab 导航布局（首页 / 任务 / 我的） */
export default function TabLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const currentSite = useAuthStore((s) => s.currentSite);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    const siteId = currentSite?.id;
    void prefetchResource(
      mobileCacheKeys.homeTasks(user?.id, siteId),
      () => fetchTasks({ page: 1, limit: 20, siteId }),
    );
    void prefetchResource(
      mobileCacheKeys.taskList(user?.id, siteId, 'all||||'),
      () => fetchTasks({ page: 1, limit: 50, siteId }),
    );
    void prefetchResource(
      mobileCacheKeys.inspectorSummary(user?.id, siteId),
      () => fetchInspectorSummary(siteId),
    );
  }, [currentSite?.id, user?.id]);

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
          <Tabbar.Item name="/m" icon={<HomeIcon />}>
            首页
          </Tabbar.Item>
          <Tabbar.Item name="/m/tasks" icon={<TasksIcon />}>
            任务
          </Tabbar.Item>
          <Tabbar.Item name="/m/my" icon={<UserIcon />}>
            我的
          </Tabbar.Item>
        </Tabbar>
      )}
    </div>
  );
}
