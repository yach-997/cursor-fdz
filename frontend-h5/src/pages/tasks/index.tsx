import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PullRefresh, Dialog, Toast } from 'react-vant';
import { fetchTasks, deleteTask, type TaskItem } from '../../api/task';
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

function statusClass(status: string, label?: string) {
  const t = label || status;
  if (t.includes('完成') || status === 'submitted' || status === 'approved') return 'is-done';
  if (
    t.includes('驳回') ||
    t.includes('整改') ||
    status === 'rejected' ||
    status === 'in_progress'
  ) {
    return 'is-doing';
  }
  return 'is-todo';
}

function statusText(t: TaskItem) {
  // 列表只展示三类：未开始 / 进行中 / 已完成
  if (t.status === 'pending') return '未开始';
  if (t.status === 'submitted' || t.status === 'approved') return '已完成';
  if (t.status === 'archived') return '已归档';
  return '进行中';
}

/** 任务列表：未开始 / 进行中 / 已完成 */
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
  const loader = useCallback(() => fetchTasks({
      page: 1,
      limit: 50,
      statusGroup: tab === 'all' ? undefined : tab,
      keyword: appliedFilters.keyword || undefined,
      region: appliedFilters.region || undefined,
      startDate: appliedFilters.dateFrom || undefined,
      endDate: appliedFilters.dateTo || undefined,
      siteId: currentSite?.id,
    }), [tab, appliedFilters, currentSite?.id]);
  const filterKey = [
    tab,
    appliedFilters.keyword,
    appliedFilters.region,
    appliedFilters.dateFrom,
    appliedFilters.dateTo,
  ].join('|');
  const { data, loading, error, reload } = useCachedResource(
    mobileCacheKeys.taskList(user?.id, currentSite?.id, filterKey),
    loader,
  );
  const list: TaskItem[] = (data?.list || []).filter((t) => t.status !== 'archived');
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

  return (
    <div className="tasks-page">
      <header className="tasks-page__header">
        <h1 className="tasks-page__title">任务</h1>
        <p className="tasks-page__sub">
          {currentSite?.name ? `当前现场 · ${currentSite.name}` : '未选择现场时可查看全部任务'}
        </p>
      </header>

      <div className="tasks-page__search">
        <span aria-hidden style={{ color: '#9aaba2', fontSize: 16 }}>
          ⌕
        </span>
        <input
          value={keyword}
          placeholder="搜索任务名称"
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
        onClick={() => navigate('/m/tasks/create')}
      >
        临时新建巡检
      </button>

      <PullRefresh onRefresh={load}>
        <div className="tasks-page__list">
          {loading ? (
            <div className="mobile-list-skeleton" aria-label="正在加载任务">
              <i /><i /><i />
            </div>
          ) : error && data === undefined ? (
            <button type="button" className="mobile-load-error" onClick={() => void load()}>
              数据暂时没有加载成功，点击重试
            </button>
          ) : list.length === 0 ? (
            <div className="tasks-page__empty">
              <Empty description="暂无任务，点上方新建" />
            </div>
          ) : (
            list.map((t) => {
              const label = statusText(t);
              const canDelete = ['pending', 'in_progress', 'rejected'].includes(t.status);
              const region = t.site?.region || t.site?.name || '';
              return (
                <div
                  key={t.id}
                  className="tasks-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/m/tasks/${t.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/m/tasks/${t.id}`);
                  }}
                >
                  <div className="tasks-item__top">
                    <div className="tasks-item__name">{t.taskName}</div>
                    <div className={`tasks-item__status ${statusClass(t.status, label)}`}>
                      {label}
                    </div>
                  </div>
                  <div className="tasks-item__meta">
                    {t.device?.serialNumber || '无序列号'}
                    {region ? ` · ${region}` : ''}
                  </div>
                  {t.record?.rejectReason?.reason && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: '#a8071a',
                        lineHeight: 1.4,
                      }}
                    >
                      驳回：{t.record.rejectReason.reason}
                      {t.record.rejectReason.entryIds?.length
                        ? `（${t.record.rejectReason.entryIds.length} 项需返工）`
                        : ''}
                    </div>
                  )}
                  {canDelete && (
                    <div className="tasks-item__actions">
                      <button
                        type="button"
                        className="tasks-item__del"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelete(t);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </PullRefresh>
    </div>
  );
}
