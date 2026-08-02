import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PullRefresh } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchTasks, type TaskItem } from '../../api/task';
import { fetchMyFinanceCases, type MobileFinanceCase } from '../../api/finance';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';
import './home.css';

const STATUS_TEXT: Record<string, string> = {
  pending: '未开始',
  in_progress: '进行中',
  submitted: '已完成',
  approved: '已完成',
  rejected: '需返工',
  archived: '已归档',
  draft: '进行中',
  assigned: '未开始',
  working: '进行中',
  finished: '已完成',
};

type HomeItem = {
  key: string;
  title: string;
  meta: string;
  status: string;
  statusLabel: string;
  href: string;
};

/** 首页：当前站点 + 待办作业 */
export default function HomePage() {
  const navigate = useNavigate();
  const { currentSite, user } = useAuthStore();
  const profileIncomplete = !user?.realName?.trim() || !user?.phone?.trim();

  const loader = useCallback(async () => {
    const [taskPage, financeCases] = await Promise.all([
      fetchTasks({
        page: 1,
        limit: 20,
        siteId: currentSite?.id,
      }),
      fetchMyFinanceCases().catch(() => [] as MobileFinanceCase[]),
    ]);
    return { tasks: taskPage.list as TaskItem[], financeCases };
  }, [currentSite?.id]);

  const { data, loading, error, reload } = useCachedResource(
    mobileCacheKeys.homeTasks(user?.id, currentSite?.id) + ':unified-v2',
    loader,
  );

  const items: HomeItem[] = useMemo(() => {
    const allTasks = data?.tasks || [];
    const taskByCaseId = new Map(
      allTasks
        .filter((t) => t.serviceCaseId)
        .map((t) => [String(t.serviceCaseId), t] as const),
    );
    const list: HomeItem[] = [];

    for (const c of data?.financeCases || []) {
      if (!['assigned', 'working'].includes(c.status)) continue;
      if (currentSite?.id && c.siteId && c.siteId !== currentSite.id) continue;
      const linked = taskByCaseId.get(String(c.id));
      const status = linked?.status || c.status;
      const statusLabel = linked
        ? linked.statusLabel && linked.statusLabel !== '草稿'
          ? linked.statusLabel
          : STATUS_TEXT[linked.status] || '进行中'
        : STATUS_TEXT[c.status] || c.status;
      list.push({
        key: `case-${c.id}`,
        title: c.projectName || c.gspCaseNo,
        meta: `${c.gspCaseNo} · ${c.taskTypeName || '未设类型'}`,
        status,
        statusLabel,
        href: `/m/finance-cases/${c.id}`,
      });
    }

    // 进行中优先，便于现场直接点进
    list.sort((a, b) => {
      const rank = (s: string) =>
        s === 'in_progress' || s === 'working' || s === 'rejected' ? 0 : 1;
      return rank(a.status) - rank(b.status);
    });
    return list;
  }, [data, currentSite?.id]);

  const stats = useMemo(
    () => ({
      pending: items.filter((t) => t.status === 'pending' || t.status === 'assigned').length,
      inProgress: items.filter((t) =>
        ['in_progress', 'working', 'rejected'].includes(t.status),
      ).length,
    }),
    [items],
  );

  const onPrimary = () => {
    if (!currentSite) {
      navigate('/m/sites');
      return;
    }
    if (items[0]) {
      navigate(items[0].href);
      return;
    }
    navigate('/m/tasks');
  };

  return (
    <div className="page-home">
      <PullRefresh onRefresh={() => void reload()}>
        <header className="home-hero">
          <div className="home-hero__top">
            <div className="home-brand">
              <span>光</span>
              <b>现场作业台</b>
            </div>
            <button type="button" className="home-site-switch" onClick={() => navigate('/m/sites')}>
              切换站点 ›
            </button>
          </div>
          <div className="home-hero__site">
            <small>当前站点</small>
            <h1>{currentSite?.name || '尚未选择站点'}</h1>
            <p>
              {currentSite
                ? `${currentSite.province || ''}${currentSite.city || ''} · ${currentSite.code}`
                : '请先选择今日作业站点'}
            </p>
          </div>
        </header>

        <main className="home-content">
          {profileIncomplete && (
            <button type="button" className="home-profile-tip" onClick={() => navigate('/m/settings')}>
              <span>!</span>
              <b>完善个人信息</b>
              <small>确保报告签署准确</small>
              <i>›</i>
            </button>
          )}

          <section className="home-overview">
            <div className="home-greeting">
              <div>
                <small>
                  {new Date().getHours() < 12
                    ? '早上好'
                    : new Date().getHours() < 18
                      ? '下午好'
                      : '晚上好'}
                </small>
                <h2>{user?.realName || user?.username}</h2>
              </div>
              <span>
                {new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </span>
            </div>

            {loading || data === undefined ? (
              <div className="home-stats home-stats--loading home-stats--2" aria-label="正在加载">
                <i />
                <i />
              </div>
            ) : (
              <div className="home-stats home-stats--2">
                <div>
                  <b>{stats.pending}</b>
                  <span>待接单</span>
                </div>
                <div>
                  <b>{stats.inProgress}</b>
                  <span>作业中</span>
                </div>
              </div>
            )}

            <button type="button" className="home-start" onClick={onPrimary}>
              <span className="home-start__icon">→</span>
              <span>
                <b>
                  {!currentSite
                    ? '先选择站点'
                    : items[0]
                      ? items[0].status === 'assigned' || items[0].status === 'pending'
                        ? '继续接单作业'
                        : '继续当前作业'
                      : '查看全部作业'}
                </b>
                <small>
                  {!currentSite
                    ? '选择站点后查看已派工单'
                    : items[0]
                      ? items[0].title
                      : '暂无待办，下拉刷新或等待派单'}
                </small>
              </span>
              <i>›</i>
            </button>
          </section>

          <div className="home-section-title">
            <div>
              <h3>待办作业</h3>
              <span>网格长已派、待现场完成</span>
            </div>
            <button type="button" onClick={() => navigate('/m/tasks')}>
              全部 ›
            </button>
          </div>

          {loading ? (
            <div className="mobile-list-skeleton" aria-label="正在加载">
              <i />
              <i />
              <i />
            </div>
          ) : error && data === undefined ? (
            <button type="button" className="mobile-load-error" onClick={() => void reload()}>
              数据暂时没有加载成功，点击重试
            </button>
          ) : items.length === 0 ? (
            <div className="home-empty">
              <Empty description={currentSite ? '本站暂无待办作业' : '请先选择站点'} />
            </div>
          ) : (
            <div className="home-task-list">
              {items.slice(0, 8).map((t) => (
                <button
                  type="button"
                  className="home-task"
                  key={t.key}
                  onClick={() => navigate(t.href)}
                >
                  <span className={`home-task__dot is-${t.status}`} />
                  <span className="home-task__main">
                    <b>{t.title}</b>
                    <small>{t.meta}</small>
                  </span>
                  <span className="home-task__status">{t.statusLabel}</span>
                  <i>›</i>
                </button>
              ))}
            </div>
          )}
        </main>
      </PullRefresh>
    </div>
  );
}
