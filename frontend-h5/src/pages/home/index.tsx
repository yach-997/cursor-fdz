import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Card, Grid, Empty, Tag, Cell, PullRefresh, Button } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchTasks, type TaskItem } from '../../api/task';

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
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState({ pending: 0, inProgress: 0, done: 0 });

  const profileIncomplete = !user?.realName?.trim() || !user?.phone?.trim();

  const load = useCallback(async () => {
    const res = await fetchTasks({
      page: 1,
      limit: 20,
      siteId: currentSite?.id,
    });
    setTasks(res.list);
    setStats({
      pending: res.list.filter((t) => t.status === 'pending').length,
      inProgress: res.list.filter((t) => t.status === 'in_progress').length,
      done: res.list.filter((t) => ['submitted', 'approved'].includes(t.status)).length,
    });
  }, [currentSite?.id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <div className="page-home">
      <NavBar
        title={currentSite?.name || '未选择站点'}
        rightText="切换"
        onClickRight={() => navigate('/m/sites')}
      />
      <PullRefresh onRefresh={load}>
        <div style={{ padding: 12 }}>
          {profileIncomplete && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                background: '#fff7e6',
                borderRadius: 8,
                fontSize: 13,
                color: '#ad6800',
              }}
              onClick={() => navigate('/m/settings')}
            >
              请先完善姓名、手机号等个人信息 →
            </div>
          )}

          <Card round style={{ marginBottom: 12 }}>
            <Card.Header>你好，{user?.realName || user?.username}</Card.Header>
            <Card.Body>
              <Grid columnNum={3} border={false}>
                <Grid.Item text={`${stats.pending}\n待办`} />
                <Grid.Item text={`${stats.inProgress}\n进行中`} />
                <Grid.Item text={`${stats.done}\n本页完成`} />
              </Grid>
              <Button
                type="primary"
                block
                round
                style={{ marginTop: 12, height: 48 }}
                onClick={() => navigate('/m/start')}
              >
                开始巡检
              </Button>
              <div style={{ marginTop: 8, fontSize: 12, color: '#888', textAlign: 'center' }}>
                选择地区 → 项目 → 设备类型 → 进入检查
              </div>
            </Card.Body>
          </Card>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>我的任务</strong>
            <Tag type="primary" plain onClick={() => navigate('/m/tasks')}>
              全部
            </Tag>
          </div>

          {tasks.length === 0 ? (
            <Empty description="暂无任务，可点「开始巡检」筛选，或等待站长分配" />
          ) : (
            <Cell.Group inset>
              {tasks.slice(0, 8).map((t) => (
                <Cell
                  key={t.id}
                  title={t.taskName}
                  label={t.device?.serialNumber || t.deviceId}
                  value={
                    t.statusLabel && t.statusLabel !== '草稿'
                      ? t.statusLabel
                      : STATUS_TEXT[t.status] || '进行中'
                  }
                  isLink
                  onClick={() => navigate(`/m/tasks/${t.id}`)}
                />
              ))}
            </Cell.Group>
          )}
        </div>
      </PullRefresh>
    </div>
  );
}
