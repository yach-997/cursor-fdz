import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PullRefresh, Toast } from 'react-vant';
import { fetchTasks, type TaskItem } from '../../api/task';
import { fetchMyFinanceCases, type MobileFinanceCase } from '../../api/finance';
import { useAuthStore } from '../../stores/auth';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';
import { useNewOrderNotice, useVisiblePolling } from '../../utils/useVisiblePolling';
import type { SiteBrief } from '../../types';
import './tasks.css';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'not_started', label: '未开始' },
  { key: 'in_progress', label: '进行中' },
  { key: 'completed', label: '已完成' },
] as const;

interface UnifiedItem {
  key: string;
  title: string;
  statusLabel: string;
  statusClass: string;
  meta: string;
  rejectReason?: string;
  financeCase?: MobileFinanceCase;
}

function statusClass(status: string, label?: string) {
  const t = label || status;
  if (t.includes('完成') || status === 'submitted' || status === 'approved' || status === 'finished') {
    return 'is-done';
  }
  if (
    t.includes('驳回') ||
    t.includes('返工') ||
    status === 'rejected' ||
    status === 'in_progress' ||
    status === 'working'
  ) {
    return 'is-doing';
  }
  return 'is-todo';
}

function financeStatusText(c: MobileFinanceCase) {
  if (['finished', 'settle_review', 'settled', 'month_locked'].includes(c.status)) {
    return '已完成';
  }
  if (c.status === 'working') {
    const planned = Number(c.plannedUnits) || 0;
    const done = Number(c.completedUnits) || 0;
    if ((c.assignMode === 'multi' || planned > 1) && planned > 0) {
      return `进行中 ${done}/${planned}`;
    }
    return '进行中';
  }
  if (c.status === 'assigned') return '待接单';
  return c.status;
}

function financeMatchesTab(status: string, tab: (typeof FILTERS)[number]['key']) {
  if (tab === 'all') return true;
  if (tab === 'not_started') return status === 'assigned';
  if (tab === 'in_progress') return status === 'working';
  if (tab === 'completed') {
    return ['finished', 'settle_review', 'settled', 'month_locked'].includes(status);
  }
  return true;
}

/** 作业列表：当前站作业 + 其他站有单提示 */
export default function TasksPage() {
  const navigate = useNavigate();
  const currentSite = useAuthStore((s) => s.currentSite);
  const user = useAuthStore((s) => s.user);
  const setCurrentSite = useAuthStore((s) => s.setCurrentSite);
  const [tab, setTab] = useState<(typeof FILTERS)[number]['key']>('all');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  const siteBriefById = useMemo(() => {
    const map = new Map<string, SiteBrief>();
    for (const m of user?.siteMemberships || []) {
      if (m.site?.id) map.set(m.site.id, m.site);
    }
    return map;
  }, [user?.siteMemberships]);

  const loader = useCallback(async () => {
    const [taskPage, financeCases] = await Promise.all([
      fetchTasks({
        page: 1,
        limit: 50,
        statusGroup: tab === 'all' ? undefined : tab,
        keyword: appliedKeyword || undefined,
        siteId: currentSite?.id,
      }),
      fetchMyFinanceCases().catch(() => [] as MobileFinanceCase[]),
    ]);
    return { tasks: taskPage.list, financeCases };
  }, [tab, appliedKeyword, currentSite?.id]);

  const { data, loading, error, reload } = useCachedResource(
    mobileCacheKeys.taskList(
      user?.id,
      currentSite?.id,
      `site-jobs|${tab}|${appliedKeyword}`,
    ),
    loader,
  );

  useVisiblePolling({ reload, intervalMs: 30_000 });

  const activeCaseIds = useMemo(
    () =>
      (data?.financeCases || [])
        .filter((c) => ['assigned', 'working'].includes(c.status))
        .map((c) => String(c.id)),
    [data?.financeCases],
  );

  const notifyNewOrders = useCallback((count: number) => {
    Toast.info(count === 1 ? '有新派单，已更新列表' : `有 ${count} 笔新派单，已更新列表`);
  }, []);

  useNewOrderNotice(
    activeCaseIds,
    notifyNewOrders,
    `${currentSite?.id || 'all'}|${tab}|${appliedKeyword}`,
  );

  const { list, otherTips } = useMemo(() => {
    const allTasks = (data?.tasks || []).filter((t) => t.status !== 'archived');
    const taskByCaseId = new Map(
      allTasks
        .filter((t) => t.serviceCaseId)
        .map((t) => [String(t.serviceCaseId), t] as const),
    );
    const items: UnifiedItem[] = [];
    const otherCount = new Map<string, number>();
    const kw = appliedKeyword.toLowerCase();

    for (const c of data?.financeCases || []) {
      if (currentSite?.id && c.siteId && c.siteId !== currentSite.id) {
        if (['assigned', 'working'].includes(c.status)) {
          otherCount.set(c.siteId, (otherCount.get(c.siteId) || 0) + 1);
        }
        continue;
      }
      if (currentSite?.id && c.siteId && c.siteId !== currentSite.id) continue;
      if (currentSite?.id && !c.siteId) continue;

      const linked = taskByCaseId.get(String(c.id));
      if (!financeMatchesTab(c.status, tab)) continue;
      if (kw && !`${c.projectName} ${c.gspCaseNo}`.toLowerCase().includes(kw)) continue;
      const rejectTask =
        linked?.status === 'rejected'
          ? linked
          : allTasks.find(
              (t) => String(t.serviceCaseId) === String(c.id) && t.status === 'rejected',
            );
      const label =
        rejectTask?.status === 'rejected' ? '需返工' : financeStatusText(c);
      const statusForClass = rejectTask?.status === 'rejected' ? 'rejected' : c.status;
      const reject = rejectTask?.record?.rejectReason?.reason;
      items.push({
        key: `case-${c.id}`,
        title: c.projectName || c.gspCaseNo,
        statusLabel: label,
        statusClass: statusClass(statusForClass, label),
        meta: `${c.gspCaseNo} · ${c.taskTypeName || '未设类型'}`,
        rejectReason: reject
          ? `驳回：${reject}${
              rejectTask?.record?.rejectReason?.entryIds?.length
                ? `（${rejectTask.record.rejectReason.entryIds.length} 项需返工）`
                : ''
            }`
          : undefined,
        financeCase: c,
      });
    }

    const tips = [...otherCount.entries()]
      .map(([siteId, count]) => {
        const site = siteBriefById.get(siteId);
        return site ? { site, count } : null;
      })
      .filter((x): x is { site: SiteBrief; count: number } => !!x);

    return { list: items, otherTips: tips };
  }, [data, tab, appliedKeyword, currentSite?.id, siteBriefById]);

  return (
    <div className="tasks-page">
      <header className="tasks-page__header">
        <h1 className="tasks-page__title">作业</h1>
        <p className="tasks-page__sub">
          {currentSite?.name
            ? `当前网格 · ${currentSite.name}`
            : '未选择网格，请先在首页切换网格'}
        </p>
      </header>

      {otherTips.length > 0 && (
        <div className="tasks-page__other">
          {otherTips.map(({ site, count }) => (
            <button
              key={site.id}
              type="button"
              className="tasks-page__other-item"
              onClick={() => setCurrentSite(site)}
            >
              <span>
                <b>{site.name}</b> 有 {count} 单待办
              </span>
              <i>切换 ›</i>
            </button>
          ))}
        </div>
      )}

      <div className="tasks-page__search">
        <span className="tasks-page__search-icon" aria-hidden>
          搜
        </span>
        <input
          value={keyword}
          placeholder="搜索项目名 / 案例号"
          onChange={(e) => {
            const v = e.target.value;
            setKeyword(v);
            if (!v.trim() && appliedKeyword) setAppliedKeyword('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setAppliedKeyword(keyword.trim());
          }}
        />
        {keyword && (
          <button
            type="button"
            className="tasks-page__search-clear"
            onClick={() => {
              setKeyword('');
              setAppliedKeyword('');
            }}
          >
            清除
          </button>
        )}
        <button
          type="button"
          className="tasks-page__search-go"
          onClick={() => setAppliedKeyword(keyword.trim())}
        >
          搜索
        </button>
      </div>

      <div className="tasks-page__filters" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            className={`tasks-page__filter${tab === f.key ? ' is-active' : ''}`}
            onClick={() => setTab(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <PullRefresh onRefresh={() => void reload()}>
        <div className="tasks-page__list">
          {loading ? (
            <div className="mobile-list-skeleton" aria-label="正在加载作业">
              <i />
              <i />
              <i />
            </div>
          ) : error && data === undefined ? (
            <button type="button" className="mobile-load-error" onClick={() => void reload()}>
              数据暂时没有加载成功，点击重试
            </button>
          ) : list.length === 0 ? (
            <div className="tasks-page__empty">
              <Empty
                description={
                  otherTips.length
                    ? '本网格暂无作业，可切换到上方有待办的网格'
                    : '暂无作业，请等待网格长派单'
                }
              />
            </div>
          ) : (
            list.map((item) => (
              <div
                key={item.key}
                className="tasks-item"
                role="button"
                tabIndex={0}
                onClick={() =>
                  item.financeCase && navigate(`/m/finance-cases/${item.financeCase.id}`)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && item.financeCase) {
                    navigate(`/m/finance-cases/${item.financeCase.id}`);
                  }
                }}
              >
                <div className="tasks-item__top">
                  <div className="tasks-item__name">{item.title}</div>
                  <div className={`tasks-item__status ${item.statusClass}`}>{item.statusLabel}</div>
                </div>
                <div className="tasks-item__meta">{item.meta}</div>
                {item.rejectReason && (
                  <div className="tasks-item__reject">{item.rejectReason}</div>
                )}
              </div>
            ))
          )}
        </div>
      </PullRefresh>
    </div>
  );
}
