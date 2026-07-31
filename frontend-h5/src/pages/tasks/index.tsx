import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PullRefresh, Dialog, Toast } from 'react-vant';
import { fetchTasks, deleteTask, type TaskItem } from '../../api/task';
import { fetchMyFinanceCases, type MobileFinanceCase } from '../../api/finance';
import { useAuthStore } from '../../stores/auth';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';
import './tasks.css';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'not_started', label: '未开始' },
  { key: 'in_progress', label: '进行中' },
  { key: 'completed', label: '已完成' },
] as const;

type UnifiedKind = 'inspection' | 'service';

interface UnifiedItem {
  key: string;
  kind: UnifiedKind;
  title: string;
  statusLabel: string;
  statusClass: string;
  meta: string;
  canDelete?: boolean;
  task?: TaskItem;
  financeCase?: MobileFinanceCase;
}

function statusClass(status: string, label?: string) {
  const t = label || status;
  if (t.includes('完成') || status === 'submitted' || status === 'approved' || status === 'finished') {
    return 'is-done';
  }
  if (
    t.includes('驳回') ||
    t.includes('整改') ||
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

/** 任务列表：巡检 + 服务作业统一入口，按类型分流 */
export default function TasksPage() {
  const navigate = useNavigate();
  const currentSite = useAuthStore((s) => s.currentSite);
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<(typeof FILTERS)[number]['key']>('all');
  const [keyword, setKeyword] = useState('');
  const [region, setRegion] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    keyword: '',
    region: '',
    dateFrom: '',
    dateTo: '',
  });
  const applyFilters = useCallback(() => {
    setAppliedFilters({
      keyword: keyword.trim(),
      region: region.trim(),
      dateFrom,
      dateTo,
    });
  }, [keyword, region, dateFrom, dateTo]);

  const loader = useCallback(async () => {
    const [taskPage, financeCases] = await Promise.all([
      fetchTasks({
        page: 1,
        limit: 50,
        statusGroup: tab === 'all' ? undefined : tab,
        keyword: appliedFilters.keyword || undefined,
        region: appliedFilters.region || undefined,
        startDate: appliedFilters.dateFrom || undefined,
        endDate: appliedFilters.dateTo || undefined,
        siteId: currentSite?.id,
      }),
      fetchMyFinanceCases().catch(() => [] as MobileFinanceCase[]),
    ]);
    return { tasks: taskPage.list, financeCases };
  }, [tab, appliedFilters, currentSite?.id]);

  const filterKey = [
    tab,
    appliedFilters.keyword,
    appliedFilters.region,
    appliedFilters.dateFrom,
    appliedFilters.dateTo,
  ].join('|');
  const { data, loading, error, reload } = useCachedResource(
    mobileCacheKeys.taskList(user?.id, currentSite?.id, `unified|${filterKey}`),
    loader,
  );

  const list: UnifiedItem[] = useMemo(() => {
    const tasks = (data?.tasks || []).filter((t) => t.status !== 'archived');
    const items: UnifiedItem[] = tasks.map((t) => {
      const label = inspectionStatusText(t);
      return {
        key: `task-${t.id}`,
        kind: 'inspection' as const,
        title: t.taskName,
        statusLabel: label,
        statusClass: statusClass(t.status, label),
        meta: `${t.device?.serialNumber || '无序列号'}${
          t.site?.region || t.site?.name ? ` · ${t.site?.region || t.site?.name}` : ''
        }${t.serviceCaseId ? ' · 关联案例' : ''}`,
        canDelete: ['pending', 'in_progress', 'rejected'].includes(t.status),
        task: t,
      };
    });

    const kw = appliedFilters.keyword.toLowerCase();
    for (const c of data?.financeCases || []) {
      if (currentSite?.id && c.siteId && c.siteId !== currentSite.id) continue;
      if (!financeMatchesTab(c.status, tab)) continue;
      if (kw && !`${c.projectName} ${c.gspCaseNo}`.toLowerCase().includes(kw)) continue;
      const label = financeStatusText(c.status);
      items.push({
        key: `case-${c.id}`,
        kind: 'service',
        title: c.projectName || c.gspCaseNo,
        statusLabel: label,
        statusClass: statusClass(c.status, label),
        meta: `${c.gspCaseNo} · ${c.taskType === 'inspection' ? '巡检案例' : '服务作业'}${c.province ? ` · ${c.province}` : ''}`,
        financeCase: c,
      });
    }
    return items;
  }, [data, tab, appliedFilters.keyword, currentSite?.id]);

  const load = useCallback(async () => {
    await reload();
  }, [reload]);

  const onDelete = async (t: TaskItem) => {
    try {
      await Dialog.confirm({
        title: '删除任务',
        message: `确认删除「${t.taskName}」？可重新创建。`,
        confirmButtonText: '删除',
        confirmButtonColor: '#c45c5c',
      });
    } catch {
      return;
    }
    try {
      await deleteTask(t.id);
      Toast.success('已删除');
      void load();
    } catch {
      /* 拦截器 */
    }
  };

  const openItem = (item: UnifiedItem) => {
    if (item.kind === 'service' && item.financeCase) {
      navigate(`/m/finance-cases/${item.financeCase.id}`);
      return;
    }
    if (item.task) navigate(`/m/tasks/${item.task.id}`);
  };

  return (
    <div className="tasks-page">
      <header className="tasks-page__header">
        <h1 className="tasks-page__title">任务</h1>
        <p className="tasks-page__sub">
          {currentSite?.name
            ? `当前现场 · ${currentSite.name}（含巡检与服务作业）`
            : '未选择现场时可查看全部任务'}
        </p>
      </header>

      <div className="tasks-page__search">
        <span aria-hidden style={{ color: '#9aaba2', fontSize: 16 }}>
          ⌕
        </span>
        <input
          value={keyword}
          placeholder="搜索任务/案例"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilters();
          }}
        />
      </div>

      <div className="tasks-page__search" style={{ marginTop: 8 }}>
        <input
          value={region}
          placeholder="区域（省/市/现场）"
          onChange={(e) => setRegion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilters();
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          margin: '8px 20px 0',
          alignItems: 'center',
        }}
      >
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{
            flex: 1,
            height: 40,
            borderRadius: 10,
            border: '1px solid rgba(26, 80, 55, 0.08)',
            padding: '0 10px',
            background: 'rgba(255,255,255,0.88)',
            fontFamily: 'inherit',
          }}
        />
        <span style={{ color: '#6b7a72', fontSize: 12 }}>至</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{
            flex: 1,
            height: 40,
            borderRadius: 10,
            border: '1px solid rgba(26, 80, 55, 0.08)',
            padding: '0 10px',
            background: 'rgba(255,255,255,0.88)',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={applyFilters}
          style={{
            height: 40,
            padding: '0 12px',
            border: 'none',
            borderRadius: 10,
            background: '#2f9b6a',
            color: '#fff',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        >
          筛选
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

      <button
        type="button"
        className="tasks-page__create"
        onClick={() => navigate('/m/finance-cases')}
      >
        查看费用案例
      </button>

      <PullRefresh onRefresh={load}>
        <div className="tasks-page__list">
          {loading ? (
            <div className="mobile-list-skeleton" aria-label="正在加载任务">
              <i />
              <i />
              <i />
            </div>
          ) : error && data === undefined ? (
            <button type="button" className="mobile-load-error" onClick={() => void load()}>
              数据暂时没有加载成功，点击重试
            </button>
          ) : list.length === 0 ? (
            <div className="tasks-page__empty">
              <Empty description="暂无待办，请等待网格长按案例派单" />
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
                {item.task?.record?.rejectReason?.reason && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: '#a8071a',
                      lineHeight: 1.4,
                    }}
                  >
                    驳回：{item.task.record.rejectReason.reason}
                    {item.task.record.rejectReason.entryIds?.length
                      ? `（${item.task.record.rejectReason.entryIds.length} 项需返工）`
                      : ''}
                  </div>
                )}
                {item.canDelete && item.task && (
                  <div className="tasks-item__actions">
                    <button
                      type="button"
                      className="tasks-item__del"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDelete(item.task!);
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </PullRefresh>
    </div>
  );
}
