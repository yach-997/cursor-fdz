import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, Loading, Toast } from 'react-vant';
import {
  fetchMyFinanceCase,
  finishFinanceCase,
  startFinanceCase,
  type MobileFinanceCase,
} from '../../api/finance';
import './finance.css';

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '未开始',
  in_progress: '巡检中',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回·需返工',
};

export default function FinanceCaseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<MobileFinanceCase>();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const result = await fetchMyFinanceCase(id);
    setItem(result);
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (!item)
    return (
      <div className="mobile-finance-page">
        <Loading vertical>加载案例...</Loading>
      </div>
    );

  const enterInspection = async (autoStart: boolean) => {
    setBusy(true);
    try {
      let current = item;
      if (autoStart && current.status === 'assigned') {
        current = await startFinanceCase(id);
        setItem(current);
      } else if (!current.inspectionTaskId) {
        current = await startFinanceCase(id);
        setItem(current);
      }
      const taskId = current.inspectionTaskId;
      if (!taskId) {
        Toast.fail('未找到巡检任务，请联系网格长确认任务类型');
        return;
      }
      navigate(`/m/inspection/${taskId}`);
    } catch {
      /* 拦截器 */
    } finally {
      setBusy(false);
    }
  };

  const canInspect = ['assigned', 'working'].includes(item.status) && !item.inspectionDone;
  const canFinish =
    item.status === 'working' &&
    (item.inspectionDone ||
      item.inspectionTaskStatus === 'submitted' ||
      item.inspectionTaskStatus === 'approved');

  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head">
        <button onClick={() => navigate('/m/finance-cases')}>← 返回</button>
        <h1>案例巡检</h1>
      </header>

      <section className="mobile-finance-card">
        <div className="mobile-finance-row">
          <h2>{item.projectName}</h2>
          <span className="mobile-finance-status">
            {item.status === 'assigned' ? '待开始' : item.status === 'working' ? '作业中' : '已完工'}
          </span>
        </div>
        <p className="mobile-finance-muted">{item.gspCaseNo}</p>
        <p>
          {item.province || '-'} · {item.city || '-'}
        </p>
        <p style={{ marginTop: 8 }}>
          任务类型：<b>{item.taskTypeName || item.taskType || '未设置'}</b>
        </p>
        {item.inspectionTaskStatus && (
          <p className="mobile-finance-muted" style={{ marginTop: 6 }}>
            巡检进度：{TASK_STATUS_LABEL[item.inspectionTaskStatus] || item.inspectionTaskStatus}
          </p>
        )}

        {item.status === 'assigned' && (
          <button
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={() => void enterInspection(true)}
          >
            接单并开始巡检
          </button>
        )}

        {item.status === 'working' && canInspect && (
          <button
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={() => void enterInspection(false)}
          >
            {item.inspectionTaskStatus === 'rejected'
              ? '继续返工巡检'
              : item.inspectionTaskStatus === 'in_progress'
                ? '继续巡检'
                : '开始巡检'}
          </button>
        )}

        {item.inspectionTaskId && item.inspectionDone && (
          <button
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => navigate(`/m/tasks/${item.inspectionTaskId}`)}
          >
            查看巡检报告
          </button>
        )}
      </section>

      {canFinish && (
        <section className="mobile-finance-card">
          <h3>巡检已提交</h3>
          <p className="mobile-finance-muted">现场巡检报告已提交，确认后本单完工进入后续结算。</p>
          <button
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={async () => {
              try {
                await Dialog.confirm({
                  title: '确认完工',
                  message: '确认本单巡检已完成？确认后进入结算流程。',
                });
              } catch {
                return;
              }
              setBusy(true);
              try {
                await finishFinanceCase(id);
                Toast.success('案例已完工');
                navigate('/m/finance-cases', { replace: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            确认完工
          </button>
        </section>
      )}

      {item.status === 'working' && !item.inspectionDone && (
        <section className="mobile-finance-card">
          <h3>现场巡检说明</h3>
          <p className="mobile-finance-muted">
            由工程师按检查条目现场拍照完成巡检；提交后系统辅助分析并生成报告，分析结果仅供参考。
          </p>
        </section>
      )}

      {!['assigned', 'working'].includes(item.status) && (
        <section className="mobile-finance-card">
          <h3>作业已完工</h3>
          <p className="mobile-finance-muted">可在「我的收入」查看核算与审核状态。</p>
          {item.inspectionTaskId && (
            <button
              className="mobile-finance-secondary"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => navigate(`/m/tasks/${item.inspectionTaskId}`)}
            >
              查看巡检报告
            </button>
          )}
        </section>
      )}
    </div>
  );
}
