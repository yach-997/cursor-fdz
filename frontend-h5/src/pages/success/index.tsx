import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Toast } from 'react-vant';
import { completeFinanceUnit, finishFinanceCase } from '../../api/finance';
import { resolveWorkTypeLabel, workActionLabel } from '../../utils/workTypeLabels';
import './success.css';

/** 提交成功页：费用案例按台完工（行程已改为详情可选，不再拦完工） */
export default function SuccessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as {
    recordId?: string;
    taskName?: string;
    serviceCaseId?: string | null;
    workUnitId?: string | null;
    unitFlow?: boolean;
  };
  const workType = resolveWorkTypeLabel({ taskName: state.taskName });
  const isUnitFlow = !!state.workUnitId || !!state.unitFlow;
  const [caseFinishing, setCaseFinishing] = useState(!!state.serviceCaseId);
  const [caseFinished, setCaseFinished] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);

  const runFinish = useCallback(async () => {
    if (!state.serviceCaseId) return;
    setCaseFinishing(true);
    setFinishFailed(false);
    try {
      if (state.workUnitId) {
        await completeFinanceUnit(state.serviceCaseId, state.workUnitId, {
          skipErrorToast: true,
        });
      } else if (!isUnitFlow) {
        await finishFinanceCase(state.serviceCaseId, { skipErrorToast: true });
      } else {
        setCaseFinished(false);
        setFinishFailed(true);
        Toast.fail('未找到作业台，无法自动完工。请返回作业详情核对。');
        return;
      }
      setCaseFinished(true);
      Toast.success(state.workUnitId ? '本台已完成' : '本单已自动完工');
    } catch {
      setCaseFinished(false);
      setFinishFailed(true);
    } finally {
      setCaseFinishing(false);
    }
  }, [state.serviceCaseId, state.workUnitId, isUnitFlow]);

  useEffect(() => {
    if (!state.serviceCaseId) return;
    let cancelled = false;
    void (async () => {
      await runFinish();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [state.serviceCaseId, runFinish]);

  const statusLine = (() => {
    if (!state.serviceCaseId) return '报告已提交，可稍后查看分析结果。';
    if (isUnitFlow) {
      if (caseFinishing) return '正在标记本台完成…';
      if (caseFinished) return '本台已完成，可继续填行程或返回列表。';
      return finishFailed
        ? '本台未能自动完成，可点下方重试，或到作业详情核对。'
        : '若本台未自动完成，请到作业详情确认。';
    }
    if (caseFinishing) return '正在自动完工…';
    if (caseFinished) return '本单已完工，无需再点确认完工。';
    return finishFailed
      ? '自动完工失败，可点下方重试。'
      : '系统将在流程齐备后自动完工。';
  })();

  const projectHint = state.taskName
    ? state.taskName.length > 36
      ? `${state.taskName.slice(0, 36)}…`
      : state.taskName
    : '';

  const goReport = () => {
    if (state.recordId) navigate(`/m/report/${state.recordId}`);
  };
  const goCase = () => {
    if (state.serviceCaseId) {
      navigate(`/m/finance-cases/${state.serviceCaseId}`, { replace: true });
    }
  };
  const goList = () => navigate('/m/tasks', { replace: true });

  return (
    <div className="success-page">
      <div className="success-page__card">
        <div className="success-page__mark" aria-hidden>
          ✓
        </div>
        <h1 className="success-page__title">提交成功</h1>
        {projectHint ? <p className="success-page__project">{projectHint}</p> : null}
        <p className="success-page__status">{statusLine}</p>

        <div className="success-page__actions">
          {state.recordId ? (
            <button type="button" className="success-page__cta" onClick={goReport}>
              {workActionLabel(workType, 'report')}
            </button>
          ) : null}

          {finishFailed && state.serviceCaseId ? (
            <button
              type="button"
              className="success-page__cta"
              disabled={caseFinishing}
              onClick={() => void runFinish()}
            >
              {caseFinishing ? '正在重试…' : '重试完工'}
            </button>
          ) : null}

          <div className="success-page__links">
            {state.serviceCaseId ? (
              <button type="button" className="success-page__link" onClick={goCase}>
                作业详情
              </button>
            ) : null}
            {state.serviceCaseId ? <span className="success-page__sep" aria-hidden /> : null}
            <button type="button" className="success-page__link" onClick={goList}>
              作业列表
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
