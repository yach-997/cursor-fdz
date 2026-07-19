import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cell, Button, Dialog, Empty } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchInspectorSummary, type InspectorSummary } from '../../api/stats';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';
import './my.css';

/** 我的：头像、站点、统计、设置 */
export default function MyPage() {
  const navigate = useNavigate();
  const { user, currentSite, logout } = useAuthStore();

  const loader = useCallback(
    () => fetchInspectorSummary(currentSite?.id),
    [currentSite?.id],
  );
  const { data: summary, loading, error, reload } = useCachedResource<InspectorSummary>(
    mobileCacheKeys.inspectorSummary(user?.id, currentSite?.id),
    loader,
  );

  const onLogout = async () => {
    try {
      await Dialog.confirm({
        title: '提示',
        message: '确定退出登录？',
      });
    } catch {
      return;
    }
    await logout();
    navigate('/m/login', { replace: true });
  };

  const month = summary?.month;

  return (
    <div className="my-page">
      <header className="my-hero">
        <div className="my-hero__profile">
          <div className="my-hero__avatar" aria-hidden>
            {(user?.realName || 'U').slice(0, 1)}
          </div>
          <div className="my-hero__meta">
            <h1>{user?.realName || '-'}</h1>
            <p>{user?.phone || user?.username || '巡检员账号'}</p>
          </div>
        </div>
      </header>

      <div className="my-body">
        <Cell.Group inset>
          <Cell
            title="当前站点"
            value={currentSite?.name || '未选择'}
            isLink
            onClick={() => navigate('/m/sites')}
          />
        </Cell.Group>

        <div className="my-stats-card" style={{ marginTop: 12 }}>
          <h3 className="my-stats-card__title">本月统计</h3>
          {loading ? (
            <div className="mobile-summary-skeleton" aria-label="正在加载本月统计">
              <i />
              <i />
              <i />
            </div>
          ) : error && !summary ? (
            <button type="button" className="mobile-load-error" onClick={() => void reload()}>
              统计暂时没有加载成功，点击重试
            </button>
          ) : month ? (
            <div className="my-stats-grid">
              <div>
                <b>{month.total}</b>
                <span>任务数</span>
              </div>
              <div>
                <b>{month.completed}</b>
                <span>已完成</span>
              </div>
              <div>
                <b>{month.completionRate}%</b>
                <span>完成率</span>
              </div>
            </div>
          ) : (
            <Empty description="暂无数据" imageSize={64} />
          )}
        </div>

        <Cell.Group inset>
          <Cell title="费用案例" label="接单、登记工作量与完工" isLink onClick={() => navigate('/m/finance-cases')} />
          <Cell title="我的收入" label="查看每单绩效与审核状态" isLink onClick={() => navigate('/m/income')} />
          <Cell title="历史记录" isLink onClick={() => navigate('/m/history')} />
          <Cell title="个人资料" isLink onClick={() => navigate('/m/settings')} />
        </Cell.Group>

        <div className="my-logout">
          <Button block round type="danger" plain onClick={onLogout}>
            退出登录
          </Button>
        </div>
      </div>
    </div>
  );
}
