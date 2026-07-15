import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Cell, Empty, Tag } from 'react-vant';
import { fetchInspectorSummary, type InspectorSummary } from '../../api/stats';
import { useAuthStore } from '../../stores/auth';

const STATUS_TEXT: Record<string, string> = {
  pending: '待办',
  in_progress: '进行中',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档',
  draft: '进行中',
};

/** 历史巡检记录 */
export default function HistoryPage() {
  const navigate = useNavigate();
  const { currentSite } = useAuthStore();
  const [data, setData] = useState<InspectorSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInspectorSummary(currentSite?.id)
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [currentSite?.id]);

  const history = (data?.recentTasks || []).filter((t) =>
    ['approved', 'rejected', 'submitted', 'archived'].includes(t.status),
  );

  return (
    <div>
      <NavBar title="历史记录" onClickLeft={() => navigate(-1)} />
      {loading ? (
        <Empty description="加载中..." />
      ) : history.length === 0 ? (
        <Empty description="暂无历史记录" />
      ) : (
        <Cell.Group inset style={{ marginTop: 12 }}>
          {history.map((t) => (
            <Cell
              key={t.id}
              title={t.taskName}
              label={`${t.siteName} · ${t.deviceSerial}`}
              value={
                <Tag type={t.status === 'approved' ? 'success' : 'primary'}>
                  {STATUS_TEXT[t.status] || '未知状态'}
                </Tag>
              }
              isLink
              onClick={() => navigate(`/m/tasks/${t.id}`)}
            />
          ))}
        </Cell.Group>
      )}
    </div>
  );
}
