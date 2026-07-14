import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Cell, Empty, Toast, Button } from 'react-vant';
import { useAuthStore } from '../../stores/auth';

/** 站点选择页：多站时选择并缓存到 localStorage */
export default function SitesPage() {
  const navigate = useNavigate();
  const { user, setCurrentSite, currentSite, fetchMe, logout } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const sites = useMemo(() => {
    return (user?.siteMemberships || [])
      .filter((m) => m.site)
      .map((m) => m.site!);
  }, [user]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchMe();
      Toast.success('已刷新站点列表');
    } catch {
      // 拦截器已提示
    } finally {
      setRefreshing(false);
    }
  }, [fetchMe]);

  useEffect(() => {
    void fetchMe().catch(() => undefined);
  }, [fetchMe]);

  const onSelect = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;
    setCurrentSite(site);
    Toast.success(`已选择：${site.name}`);
    navigate('/m', { replace: true });
  };

  const onLogout = async () => {
    await logout();
    navigate('/m/login', { replace: true });
  };

  return (
    <div>
      <NavBar
        title="选择站点"
        onClickLeft={() => navigate('/m', { replace: true })}
        rightText="退出"
        onClickRight={() => void onLogout()}
      />
      {sites.length === 0 ? (
        <div style={{ padding: '24px 16px' }}>
          <Empty description="暂无可用站点" />
          <div
            style={{
              marginTop: 8,
              padding: '0 8px',
              color: '#666',
              fontSize: 13,
              lineHeight: 1.6,
              textAlign: 'center',
            }}
          >
            请先让站长在 PC「站点管理 → 人员」中聘用你为巡检员。
            <br />
            若刚完成聘用，请点下方「刷新列表」。
            <br />
            已聘账号示例：xcy002 / 123456
          </div>
          <div style={{ marginTop: 20, padding: '0 12px' }}>
            <Button
              type="primary"
              block
              round
              loading={refreshing}
              style={{ marginBottom: 12 }}
              onClick={() => void reload()}
            >
              刷新列表
            </Button>
            <Button
              block
              round
              style={{ marginBottom: 12 }}
              onClick={() => navigate('/m', { replace: true })}
            >
              返回首页
            </Button>
            <Button block round plain type="warning" onClick={() => void onLogout()}>
              退出登录
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {sites.map((site) => (
            <Cell
              key={site.id}
              title={site.name}
              label={`${site.province || ''}${site.city || ''} · ${site.code}`}
              isLink
              value={currentSite?.id === site.id ? '当前' : ''}
              onClick={() => onSelect(site.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
