import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Toast } from 'react-vant';
import { finishFinanceCase } from '../../api/finance';
import './success.css';

/** 提交成功页 */
export default function SuccessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as {
    recordId?: string;
    taskName?: string;
    serviceCaseId?: string | null;
  };
  const [caseFinishing, setCaseFinishing] = useState(!!state.serviceCaseId);
  const [caseFinished, setCaseFinished] = useState(false);

  useEffect(() => {
    if (!state.serviceCaseId) return;
    let cancelled = false;
    void (async () => {
      try {
        await finishFinanceCase(state.serviceCaseId!);
        if (!cancelled) {
          setCaseFinished(true);
          Toast.success('案例已完工');
        }
      } catch {
        /* 可能已完工或网络失败，仍可手动回案例确认 */
        if (!cancelled) setCaseFinished(false);
      } finally {
        if (!cancelled) setCaseFinishing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.serviceCaseId]);

  return (
    <div className="success-page">
      <div className="success-page__mark" aria-hidden>
        ✓
      </div>
      <h2>报告已提交</h2>
      <p>
        {state.taskName ? `「${state.taskName}」已提交。` : ''}
        系统正在辅助分析，可稍后查看报告。
        {state.serviceCaseId
          ? caseFinishing
            ? '正在完结本单案例…'
            : caseFinished
              ? '本单案例已完工。'
              : '若案例未自动完工，可返回案例页确认完工。'
          : ''}
      </p>
      <div className="success-page__actions">
        {state.recordId && (
          <Button type="primary" round block onClick={() => navigate(`/m/report/${state.recordId}`)}>
            查看巡检报告
          </Button>
        )}
        {state.serviceCaseId && !caseFinished && !caseFinishing && (
          <Button
            round
            block
            onClick={() => navigate(`/m/finance-cases/${state.serviceCaseId}`, { replace: true })}
          >
            返回案例确认完工
          </Button>
        )}
        <Button round block onClick={() => navigate('/m/tasks')}>
          继续其他巡检
        </Button>
        <Button round block onClick={() => navigate('/m')}>
          回到首页
        </Button>
      </div>
    </div>
  );
}
