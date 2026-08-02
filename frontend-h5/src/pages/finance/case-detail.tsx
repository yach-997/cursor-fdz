import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loading, Toast } from 'react-vant';
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

const CASE_STATUS_LABEL: Record<string, string> = {
  assigned: '待接单',
  working: '作业中',
  finished: '已完工',
  settle_review: '结算审核中',
  settled: '已结算',
  month_locked: '已月结',
};

export default function FinanceCaseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<MobileFinanceCase>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchMyFinanceCase(id).then(setItem);
  }, [id]);

  if (!item) {
    return (
      <div className="mobile-finance-page">
        <Loading vertical>加载案例...</Loading>
      </div>
    );
  }

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
  const needsManualFinish =
    item.status === 'working' &&
    (item.inspectionDone ||
      item.inspectionTaskStatus === 'submitted' ||
      item.inspectionTaskStatus === 'approved');
  const finished = !['assigned', 'working'].includes(item.status);

  const primaryLabel =
    item.status === 'assigned'
      ? '接单并开始巡检'
      : item.inspectionTaskStatus === 'rejected'
        ? '继续返工巡检'
        : item.inspectionTaskStatus === 'in_progress'
          ? '继续巡检'
          : '开始巡检';

  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head">
        <button type="button" onClick={() => navigate('/m/tasks')}>
          ← 返回
        </button>
        <h1>作业详情</h1>
      </header>

      <section className="mobile-finance-card">
        <div className="mobile-finance-row">
          <h2>{item.projectName || item.gspCaseNo}</h2>
          <span className="mobile-finance-status">
            {CASE_STATUS_LABEL[item.status] || item.status}
          </span>
        </div>
        <dl className="mobile-finance-meta">
          <div>
            <dt>案例号</dt>
            <dd>{item.gspCaseNo}</dd>
          </div>
          <div>
            <dt>地区</dt>
            <dd>
              {item.province || '-'}
              {item.city ? ` · ${item.city}` : ''}
            </dd>
          </div>
          <div>
            <dt>任务类型</dt>
            <dd>{item.taskTypeName || item.taskType || '未设置'}</dd>
          </div>
          {item.inspectionTaskStatus && (
            <div>
              <dt>巡检进度</dt>
              <dd>{TASK_STATUS_LABEL[item.inspectionTaskStatus] || item.inspectionTaskStatus}</dd>
            </div>
          )}
        </dl>

        {canInspect && (
          <button
            type="button"
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 16 }}
            disabled={busy}
            onClick={() => void enterInspection(item.status === 'assigned')}
          >
            {primaryLabel}
          </button>
        )}

        {(item.inspectionDone || finished) && item.inspectionTaskId && (
          <button
            type="button"
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => navigate(`/m/tasks/${item.inspectionTaskId}`)}
          >
            查看巡检报告
          </button>
        )}
      </section>

      {canInspect && (
        <section className="mobile-finance-card mobile-finance-tip">
          <h3>现场说明</h3>
          <p className="mobile-finance-muted">
            按检查条目现场拍照完成巡检；提交后系统辅助分析生成报告，分析结果仅供参考。提交成功后本单会自动完工。
          </p>
        </section>
      )}

      {needsManualFinish && (
        <section className="mobile-finance-card">
          <h3>巡检已提交</h3>
          <p className="mobile-finance-muted">
            报告已提交。若未自动完工，可点下方确认。
          </p>
          <button
            type="button"
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await finishFinanceCase(id);
                Toast.success('案例已完工');
                navigate('/m/tasks', { replace: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            确认完工
          </button>
        </section>
      )}

      {finished && (
        <section className="mobile-finance-card mobile-finance-tip">
          <h3>本单已完工</h3>
          <p className="mobile-finance-muted">可在「我的 → 我的收入」查看核算与审核状态。</p>
        </section>
      )}
    </div>
  );
}
