import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PullRefresh } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchTasks, type TaskItem } from '../../api/task';
import { fetchMyFinanceCases, type MobileFinanceCase } from '../../api/finance';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';
import type { SiteBrief } from '../../types';
import './home.css';

const STATUS_TEXT: Record<string, string> = {
  pending: '未开始',
  in_progress: '进行中',
  submitted: '已完成',
  approved: '已完成',
  rejected: '需返工',
  archived: '已归档',
  draft: '进行中',
  assigned: '待接单',
  working: '作业中',
  finished: '已完成',
};

type HomeItem = {
  key: string;
  title: string;
  meta: string;
  status: string;
  statusLabel: string;
  href: string;
  siteId?: string | null;
  siteName?: string;
};

function primaryAction(item?: HomeItem) {
  if (!item) return { title: '查看全部作业', hint: '暂无待办，下拉刷新或等待派单' };
  if (item.status === 'rejected') {
    return { title: '去返工', hint: item.title };
  }
  if (item.status === 'assigned' || item.status === 'pending') {
    return { title: '去接单', hint: item.title };
  }
  if (item.status === 'working' || item.status === 'in_progress') {
    return { title: '继续作业', hint: item.title };
  }
  return { title: '查看作业', hint: item.title };
}

/** 首页：跨站点待办汇总（站点仅作定位参考，不再挡住看单） */
export default function HomePage() {
  const navigate = useNavigate();
  const { currentSite, user, setCurrentSite } = useAuthStore();
  const profileIncomplete = !user?.realName?.trim() || !user?.phone?.trim();

  const siteNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of user?.siteMemberships || []) {
      if (m.site?.id) map.set(m.site.id, m.site.name);
    }
    return map;
  }, [user?.siteMemberships]);

  const siteBriefById = useMemo(() => {
    const map = new Map<string, SiteBrief>();
    for (const m of user?.siteMemberships || []) {
      if (m.site?.id) map.set(m.site.id, m.site);
    }
    return map;
  }, [user?.siteMemberships]);

  const loader = useCallback(async () => {
    const [taskPage, financeCases] = await Promise.all([
      fetchTasks({ page: 1, limit: 50 }),
      fetchMyFinanceCases().catch(() => [] as MobileFinanceCase[]),
    ]);
    return { tasks: taskPage.list as TaskItem[], financeCases };
  }, []);

  const { data, loading, error, reload } = useCachedResource(
    mobileCacheKeys.homeTasks(user?.id, 'all-sites') + ':v3',
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
      const linked = taskByCaseId.get(String(c.id));
      const status = linked?.status || c.status;
      const statusLabel = linked
        ? linked.statusLabel && linked.statusLabel !== '草稿'
          ? linked.statusLabel
          : STATUS_TEXT[linked.status] || '进行中'
        : STATUS_TEXT[c.status] || c.status;
      const siteName =
        (c.siteId && siteNameById.get(c.siteId)) ||
        [c.province, c.city].filter(Boolean).join('') ||
        '未分站点';
      list.push({
        key: `case-${c.id}`,
        title: c.projectName || c.gspCaseNo,
        meta: `${siteName} · ${c.gspCaseNo} · ${c.taskTypeName || '未设类型'}`,
        status,
        statusLabel,
        href: `/m/finance-cases/${c.id}`,
        siteId: c.siteId,
        siteName,
      });
    }

    list.sort((a, b) => {
      const rank = (s: string) =>
        s === 'in_progress' || s === 'working' || s === 'rejected'
          ? 0
          : s === 'assigned' || s === 'pending'
            ? 1
            : 2;
      const byStatus = rank(a.status) - rank(b.status);
      if (byStatus !== 0) return byStatus;
      // 当前定位站的单优先，方便现场作业
      const aHere = currentSite?.id && a.siteId === currentSite.id ? 0 : 1;
      const bHere = currentSite?.id && b.siteId === currentSite.id ? 0 : 1;
      return aHere - bHere;
    });
    return list;
  }, [data, siteNameById, currentSite?.id]);

  const stats = useMemo(
    () => ({
      pending: items.filter((t) => t.status === 'pending' || t.status === 'assigned').length,
      inProgress: items.filter((t) =>
        ['in_progress', 'working', 'rejected'].includes(t.status),
      ).length,
      otherSites: items.filter((t) => currentSite?.id && t.siteId && t.siteId !== currentSite.id)
        .length,
    }),
    [items, currentSite?.id],
  );

  const openItem = (item: HomeItem) => {
    if (item.siteId) {
      const brief = siteBriefById.get(item.siteId);
      if (brief && brief.id !== currentSite?.id) setCurrentSite(brief);
    }
    navigate(item.href);
  };

  const action = primaryAction(items[0]);

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
              定位站点 ›
            </button>
          </div>
          <div className="home-hero__site">
            <small>定位参考（不影响看待办）</small>
            <h1>{currentSite?.name || '未设置定位站点'}</h1>
            <p>
              {currentSite
                ? `${currentSite.province || ''}${currentSite.city || ''} · ${currentSite.code}`
                : '下方已汇总你名下全部站点待办'}
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

          {stats.otherSites > 0 && (
            <div className="home-cross-site-tip">
              另有 <b>{stats.otherSites}</b> 单在其他站点，列表已一并展示
            </div>
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

            <button
              type="button"
              className="home-start"
              onClick={() => {
                if (items[0]) openItem(items[0]);
                else navigate('/m/tasks');
              }}
            >
              <span className="home-start__icon">→</span>
              <span>
                <b>{action.title}</b>
                <small>{action.hint}</small>
              </span>
              <i>›</i>
            </button>
          </section>

          <div className="home-section-title">
            <div>
              <h3>待办作业</h3>
              <span>已汇总你负责的全部站点</span>
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
              <Empty description="暂无待办作业，等待网格长派单" />
            </div>
          ) : (
            <div className="home-task-list">
              {items.slice(0, 8).map((t) => (
                <button
                  type="button"
                  className="home-task"
                  key={t.key}
                  onClick={() => openItem(t)}
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
