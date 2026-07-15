import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PullRefresh } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchTasks, type TaskItem } from '../../api/task';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';
import './home.css';

const STATUS_TEXT: Record<string, string> = {
  pending: '未开始',
  in_progress: '进行中',
  submitted: '已完成',
  approved: '已完成',
  rejected: '已驳回',
  archived: '已归档',
  draft: '进行中',
};

/** 首页：站点名 + 开检入口 + 任务列表 */
export default function HomePage() {
  const navigate = useNavigate();
  const { currentSite, user } = useAuthStore();
  const profileIncomplete = !user?.realName?.trim() || !user?.phone?.trim();

  const loader = useCallback(() => fetchTasks({
      page: 1,
      limit: 20,
      siteId: currentSite?.id,
    }), [currentSite?.id]);
  const { data, loading, error, reload } = useCachedResource(
    mobileCacheKeys.homeTasks(user?.id, currentSite?.id),
    loader,
  );
  const tasks: TaskItem[] = useMemo(() => data?.list || [], [data]);
  const stats = useMemo(() => ({
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => ['submitted', 'approved'].includes(t.status)).length,
  }), [tasks]);
  const load = useCallback(async () => {
    await reload();
  }, [reload]);

  return (
    <div className="page-home">
      <PullRefresh onRefresh={load}>
        <header className="home-hero">
          <div className="home-hero__top">
            <div className="home-brand"><span>光</span><b>巡检工作台</b></div>
            <button type="button" className="home-site-switch" onClick={() => navigate('/m/sites')}>
              切换站点 ›
            </button>
          </div>
          <div className="home-hero__site">
            <small>当前站点</small>
            <h1>{currentSite?.name || '尚未选择站点'}</h1>
            <p>{currentSite ? `${currentSite.province || ''}${currentSite.city || ''} · ${currentSite.code}` : '请先选择今日要巡检的站点'}</p>
          </div>
        </header>

        <main className="home-content">
          {profileIncomplete && (
            <button type="button" className="home-profile-tip" onClick={() => navigate('/m/settings')}>
              <span>!</span><b>完善个人信息</b><small>确保报告签署准确</small><i>›</i>
            </button>
          )}

          <section className="home-overview">
            <div className="home-greeting">
              <div><small>{new Date().getHours() < 12 ? '早上好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}</small><h2>{user?.realName || user?.username}</h2></div>
              <span>{new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
            </div>
            {loading || data === undefined ? (
              <div className="home-stats home-stats--loading" aria-label="正在加载任务统计">
                <i /><i /><i />
              </div>
            ) : (
              <div className="home-stats">
                <div><b>{stats.pending}</b><span>待办任务</span></div>
                <div><b>{stats.inProgress}</b><span>进行中</span></div>
                <div><b>{stats.done}</b><span>已完成</span></div>
              </div>
            )}
            <button type="button" className="home-start" onClick={() => navigate('/m/start')}>
              <span className="home-start__icon">✓</span>
              <span><b>开始巡检</b><small>执行待办任务，或临时新建巡检</small></span>
              <i>›</i>
            </button>
          </section>

          <div className="home-section-title">
            <div><h3>我的任务</h3><span>优先处理进行中的巡检</span></div>
            <button type="button" onClick={() => navigate('/m/tasks')}>全部 ›</button>
          </div>

          {loading ? (
            <div className="mobile-list-skeleton" aria-label="正在加载任务">
              <i /><i /><i />
            </div>
          ) : error && data === undefined ? (
            <button type="button" className="mobile-load-error" onClick={() => void load()}>
              数据暂时没有加载成功，点击重试
            </button>
          ) : tasks.length === 0 ? (
            <div className="home-empty"><Empty description="暂无任务，可点击「开始巡检」" /></div>
          ) : (
            <div className="home-task-list">
              {tasks.slice(0, 8).map((t) => (
                <button type="button" className="home-task" key={t.id} onClick={() => navigate(`/m/tasks/${t.id}`)}>
                  <span className={`home-task__dot is-${t.status}`} />
                  <span className="home-task__main"><b>{t.taskName}</b><small>{t.device?.serialNumber || t.deviceId}</small></span>
                  <span className="home-task__status">{t.statusLabel && t.statusLabel !== '草稿' ? t.statusLabel : STATUS_TEXT[t.status] || '进行中'}</span>
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
