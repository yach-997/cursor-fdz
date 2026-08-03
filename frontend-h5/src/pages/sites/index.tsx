import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Cell, Empty, Toast, Button, Tag } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchMyFinanceCases } from '../../api/finance';

/** 站点选择页：展示各站待办数，方便切到有单的站 */
export default function SitesPage() {
  const navigate = useNavigate();
  const { user, setCurrentSite, currentSite, fetchMe, logout } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [pendingBySite, setPendingBySite] = useState<Record<string, number>>({});

  const sites = useMemo(() => {
    return (user?.siteMemberships || [])
      .filter((m) => m.site)
      .map((m) => m.site!);
  }, [user]);

  const loadPending = useCallback(async () => {
    try {
      const list = await fetchMyFinanceCases();
      const map: Record<string, number> = {};
      for (const c of list) {
        if (!c.siteId || !['assigned', 'working'].includes(c.status)) continue;
        map[c.siteId] = (map[c.siteId] || 0) + 1;
      }
      setPendingBySite(map);
    } catch {
      setPendingBySite({});
    }
  }, []);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchMe();
      await loadPending();
      Toast.success('已刷新站点列表');
    } catch {
      // 拦截器已提示
    } finally {
      setRefreshing(false);
    }
  }, [fetchMe, loadPending]);

  useEffect(() => {
    void fetchMe().catch(() => undefined);
    void loadPending();
  }, [fetchMe, loadPending]);

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
            请先让网格长在电脑端「站点管理 → 人员」中聘用你为工程师。
            <br />
            若刚完成聘用，请点下方「刷新列表」。
            <br />
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
          <div
            style={{
              margin: '0 16px 10px',
              color: '#82918c',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            作业按站点查看；有待办的站点会显示数量，点选后进入该站列表。
          </div>
          {sites.map((site) => {
            const pending = pendingBySite[site.id] || 0;
            return (
              <Cell
                key={site.id}
                title={site.name}
                label={`${site.province || ''}${site.city || ''} · ${site.code}`}
                isLink
                value={
                  pending > 0 ? (
                    <Tag type="danger" plain>
                      {pending} 单待办
                    </Tag>
                  ) : currentSite?.id === site.id ? (
                    '当前'
                  ) : (
                    ''
                  )
                }
                onClick={() => onSelect(site.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
