import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PullRefresh } from 'react-vant';
import { fetchTasks, type TaskItem } from '../../api/task';
import { fetchMyFinanceCases, type MobileFinanceCase } from '../../api/finance';
import { useAuthStore } from '../../stores/auth';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';
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
  siteId?: string | null;
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

function inspectionStatusText(t: TaskItem) {
  if (t.status === 'pending') return '未开始';
  if (t.status === 'submitted' || t.status === 'approved') return '已完成';
  if (t.status === 'rejected') return '需返工';
  if (t.status === 'archived') return '已归档';
  return '进行中';
}

function financeStatusText(status: string) {
  if (status === 'assigned') return '未开始';
  if (status === 'working') return '进行中';
  if (['finished', 'settle_review', 'settled', 'month_locked'].includes(status)) return '已完成';
  return status;
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

/** 作业列表：跨站点展示已派案例 */
export default function TasksPage() {
  const navigate = useNavigate();
  const currentSite = useAuthStore((s) => s.currentSite);
  const user = useAuthStore((s) => s.user);
  const setCurrentSite = useAuthStore((s) => s.setCurrentSite);
  const [tab, setTab] = useState<(typeof FILTERS)[number]['key']>('all');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

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
      fetchTasks({
        page: 1,
        limit: 50,
        statusGroup: tab === 'all' ? undefined : tab,
        keyword: appliedKeyword || undefined,
      }),
      fetchMyFinanceCases().catch(() => [] as MobileFinanceCase[]),
    ]);
    return { tasks: taskPage.list, financeCases };
  }, [tab, appliedKeyword]);

  const { data, loading, error, reload } = useCachedResource(
    mobileCacheKeys.taskList(user?.id, 'all-sites', `jobs|${tab}|${appliedKeyword}`),
    loader,
  );

  const list: UnifiedItem[] = useMemo(() => {
    const allTasks = (data?.tasks || []).filter((t) => t.status !== 'archived');
    const taskByCaseId = new Map(
      allTasks
        .filter((t) => t.serviceCaseId)
        .map((t) => [String(t.serviceCaseId), t] as const),
    );
    const items: UnifiedItem[] = [];
    const kw = appliedKeyword.toLowerCase();

    for (const c of data?.financeCases || []) {
      const linked = taskByCaseId.get(String(c.id));
      const tabStatus = linked
        ? linked.status === 'pending'
          ? 'assigned'
          : linked.status === 'submitted' || linked.status === 'approved'
            ? 'finished'
            : 'working'
        : c.status;
      if (!financeMatchesTab(tabStatus, tab)) continue;
      if (kw && !`${c.projectName} ${c.gspCaseNo}`.toLowerCase().includes(kw)) continue;
      const label = linked ? inspectionStatusText(linked) : financeStatusText(c.status);
      const statusForClass = linked?.status || c.status;
      const reject = linked?.record?.rejectReason?.reason;
      const siteName =
        (c.siteId && siteNameById.get(c.siteId)) ||
        [c.province, c.city].filter(Boolean).join('') ||
        '未分站点';
      items.push({
        key: `case-${c.id}`,
        title: c.projectName || c.gspCaseNo,
        statusLabel: label,
        statusClass: statusClass(statusForClass, label),
        meta: `${siteName} · ${c.gspCaseNo} · ${c.taskTypeName || '未设类型'}`,
        rejectReason: reject
          ? `驳回：${reject}${
              linked?.record?.rejectReason?.entryIds?.length
                ? `（${linked.record.rejectReason.entryIds.length} 项需返工）`
                : ''
            }`
          : undefined,
        financeCase: c,
        siteId: c.siteId,
      });
    }
    return items;
  }, [data, tab, appliedKeyword, siteNameById]);

  const openItem = (item: UnifiedItem) => {
    if (!item.financeCase) return;
    if (item.siteId) {
      const brief = siteBriefById.get(item.siteId);
      if (brief && brief.id !== currentSite?.id) setCurrentSite(brief);
    }
    navigate(`/m/finance-cases/${item.financeCase.id}`);
  };

  return (
    <div className="tasks-page">
      <header className="tasks-page__header">
        <h1 className="tasks-page__title">作业</h1>
        <p className="tasks-page__sub">已汇总你负责的全部站点待办与进度</p>
      </header>

      <div className="tasks-page__search">
        <span aria-hidden style={{ color: '#9aaba2', fontSize: 16 }}>
          ⌕
        </span>
        <input
          value={keyword}
          placeholder="搜索项目名 / 案例号"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setAppliedKeyword(keyword.trim());
          }}
        />
        {(keyword || appliedKeyword) && (
          <button
            type="button"
            className="tasks-page__search-go"
            onClick={() => setAppliedKeyword(keyword.trim())}
          >
            搜索
          </button>
        )}
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
              <Empty description="暂无作业，请等待网格长派单" />
            </div>
          ) : (
            list.map((item) => (
              <div
                key={item.key}
                className="tasks-item"
                role="button"
                tabIndex={0}
                onClick={() => openItem(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openItem(item);
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
