import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from 'react-vant';
import './success.css';

/** 提交成功页 */
export default function SuccessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as { recordId?: string; taskName?: string };

  return (
    <div className="success-page">
      <div className="success-page__mark" aria-hidden>
        ✓
      </div>
      <h2>报告已提交</h2>
      <p>
        {state.taskName ? `「${state.taskName}」已提交。` : ''}
        AI 正在后台分析，你可继续其他巡检，稍后再查看分析报告。
      </p>
      <div className="success-page__actions">
        {state.recordId && (
          <Button
            type="primary"
            round
            block
            onClick={() => navigate(`/m/report/${state.recordId}`)}
          >
            查看 AI 分析报告
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
