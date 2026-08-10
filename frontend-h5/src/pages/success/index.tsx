import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Toast } from 'react-vant';
import { completeFinanceUnit, finishFinanceCase } from '../../api/finance';
import { resolveWorkTypeLabel, workActionLabel } from '../../utils/workTypeLabels';
import './success.css';

function isTripEndMissing(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /结束里程|结束行程|导航截图/.test(msg);
}

/** 提交成功页：费用案例自动完工；缺结束里程则引导补填（兜底） */
export default function SuccessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as {
    recordId?: string;
    taskName?: string;
    serviceCaseId?: string | null;
    workUnitId?: string | null;
  };
  const workType = resolveWorkTypeLabel({ taskName: state.taskName });
  const [caseFinishing, setCaseFinishing] = useState(!!state.serviceCaseId);
  const [caseFinished, setCaseFinished] = useState(false);
  const [needTripEnd, setNeedTripEnd] = useState(false);

  useEffect(() => {
    if (!state.serviceCaseId) return;
    let cancelled = false;
    void (async () => {
      try {
        if (state.workUnitId) {
          await completeFinanceUnit(state.serviceCaseId!, state.workUnitId, {
            skipErrorToast: true,
          });
        } else {
          await finishFinanceCase(state.serviceCaseId!, { skipErrorToast: true });
        }
        if (!cancelled) {
          setCaseFinished(true);
          Toast.success('本单已自动完工');
        }
      } catch (err) {
        if (cancelled) return;
        if (isTripEndMissing(err)) {
          setNeedTripEnd(true);
          Toast.info('请先补填结束里程与导航，保存后将自动完工');
          navigate(
            `/m/finance-cases/${state.serviceCaseId}/expense?step=end&autoFinish=1${
              state.workUnitId ? `&unitId=${state.workUnitId}` : ''
            }`,
            { replace: true },
          );
          return;
        }
        setCaseFinished(false);
      } finally {
        if (!cancelled) setCaseFinishing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.serviceCaseId, state.workUnitId, navigate]);

  const subtitle = (() => {
    const name = state.taskName ? `「${state.taskName}」` : '报告';
    if (!state.serviceCaseId) return `${name}已提交，可稍后查看分析结果。`;
    if (caseFinishing) return `${name}已提交，正在自动完结本单…`;
    if (caseFinished) return `${name}已提交，本单已完工。无需再点确认完工。`;
    if (needTripEnd) return `${name}已提交。请补填结束里程后自动完工。`;
    return `${name}已提交。系统将在流程齐备后自动完工。`;
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
            {workActionLabel(workType, 'report')}
          </Button>
        )}
        {state.serviceCaseId && needTripEnd && (
          <Button
            round
            block
            type="primary"
            onClick={() =>
              navigate(
                `/m/finance-cases/${state.serviceCaseId}/expense?step=end&autoFinish=1${
                  state.workUnitId ? `&unitId=${state.workUnitId}` : ''
                }`,
                { replace: true },
              )
            }
          >
            去填写结束里程
          </Button>
        )}
        <Button round block onClick={() => navigate('/m/tasks', { replace: true })}>
          返回作业列表
        </Button>
      </div>
    </div>
  );
}
