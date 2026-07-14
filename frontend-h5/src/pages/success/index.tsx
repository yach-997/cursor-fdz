import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from 'react-vant';

/** 提交成功页 */
export default function SuccessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as { recordId?: string; taskName?: string };

  return (
    <div
      style={{
        padding: 24,
        minHeight: '100vh',
        background: '#f2f5f3',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: '#2bb673',
          color: '#fff',
          fontSize: 36,
          lineHeight: '72px',
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        ✓
      </div>
      <h2 style={{ margin: '0 0 8px', color: '#1a2e24' }}>报告已提交</h2>
      <p style={{ color: '#6b7a72', textAlign: 'center', marginBottom: 28, lineHeight: 1.6 }}>
        {state.taskName ? `「${state.taskName}」已提交。` : ''}
        AI 正在后台分析，你可继续其他巡检，稍后再查看分析报告。
      </p>
      <div style={{ width: '100%', display: 'grid', gap: 12 }}>
        {state.recordId && (
          <Button
            type="primary"
            round
            block
            style={{ height: 48 }}
            onClick={() => navigate(`/m/report/${state.recordId}`)}
          >
            查看 AI 分析报告
          </Button>
        )}
        <Button round block style={{ height: 48 }} onClick={() => navigate('/m/tasks')}>
          继续其他巡检
        </Button>
        <Button round block style={{ height: 48 }} onClick={() => navigate('/m')}>
          回到首页
        </Button>
      </div>
    </div>
  );
}
