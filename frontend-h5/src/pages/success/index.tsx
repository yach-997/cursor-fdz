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
        if (!cancelled) setCaseFinished(false);
      } finally {
        if (!cancelled) setCaseFinishing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.serviceCaseId]);

  const subtitle = (() => {
    const name = state.taskName ? `「${state.taskName}」` : '报告';
    if (!state.serviceCaseId) return `${name}已提交，可稍后查看分析结果。`;
    if (caseFinishing) return `${name}已提交，正在完结本单…`;
    if (caseFinished) return `${name}已提交，本单已完工。`;
    return `${name}已提交。若未自动完工，请返回案例确认。`;
  })();

  return (
    <div className="success-page">
      <div className="success-page__mark" aria-hidden>
        ✓
      </div>
      <h2>提交成功</h2>
      <p>{subtitle}</p>
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
            type="primary"
            onClick={() => navigate(`/m/finance-cases/${state.serviceCaseId}`, { replace: true })}
          >
            返回案例确认完工
          </Button>
        )}
        <Button round block onClick={() => navigate('/m/tasks', { replace: true })}>
          返回作业列表
        </Button>
      </div>
    </div>
  );
}
