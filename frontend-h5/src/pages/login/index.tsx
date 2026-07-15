import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Field, Toast } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import './login.css';

/** PC 入口页地址 */
const IS_LOCAL_HOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const PC_PORTAL_URL = IS_LOCAL_HOST
  ? import.meta.env.VITE_PC_URL || 'http://localhost:5173/'
  : 'https://cursor-fdz-pc.vercel.app/';

/** H5 登录页：与入口页统一的薄荷绿风格 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loading, token, user, hydrate } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const redirectAfterLogin = (loggedUser: NonNullable<typeof user>) => {
    const memberships = (loggedUser.siteMemberships || []).filter((m) => m.site);
    if (memberships.length === 0) {
      // 未聘用：进选站页（可刷新/退出），避免困在空白首页
      navigate('/m/sites', { replace: true });
      return;
    }
    if (memberships.length === 1 && memberships[0].site) {
      useAuthStore.getState().setCurrentSite(memberships[0].site);
      navigate('/m', { replace: true });
      return;
    }
    if (!useAuthStore.getState().currentSite) {
      navigate('/m/sites', { replace: true });
      return;
    }
    navigate('/m', { replace: true });
  };

  const onSubmit = async () => {
    if (!username || !password) {
      Toast.info('请输入用户名和密码');
      return;
    }
    try {
      const loggedUser = await login(username.trim(), password);
      Toast.success(`登录成功（${loggedUser.realName}）`);
      redirectAfterLogin(loggedUser);
    } catch {
      // 拦截器已提示
    }
  };

  return (
    <div className="h5-login-page">
      <button
        type="button"
        className="login-back"
        onClick={() => {
          window.location.href = PC_PORTAL_URL;
        }}
      >
        <span className="login-back__arrow" aria-hidden>
          ←
        </span>
        返回入口
      </button>

      <div className="h5-login-page__inner">
        <div className="h5-login-brand">
          <div className="h5-login-brand__logo" aria-hidden>光</div>
          <div className="h5-login-brand__eyebrow">FIELD INSPECTION</div>
          <h1>光伏储能巡检</h1>
          <p>现场任务、照片与报告，随时掌握</p>
        </div>

        <div className="h5-login-card">
          <div className="h5-login-card__head">
            <h2>巡检员登录</h2>
            <span>请使用已聘用的巡检员账号</span>
          </div>
          <Form>
            {token && user && (
              <div style={{ padding: '0 16px 8px', fontSize: 13, color: '#666' }}>
                当前：{user.realName}。输入其他账号可切换，或先退出再登。
              </div>
            )}
            <Field
              label="用户名"
              placeholder="请输入用户名"
              value={username}
              onChange={setUsername}
            />
            <Field
              type="password"
              label="密码"
              placeholder="请输入密码"
              value={password}
              onChange={setPassword}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onSubmit();
                }
              }}
            />
          </Form>
          <div className="h5-login-actions">
            <Button
              type="primary"
              block
              round
              loading={loading}
              nativeType="button"
              onClick={() => void onSubmit()}
              className="h5-login-btn"
            >
              进入巡检端
            </Button>
          </div>
        </div>
        <div className="h5-login-trust"><i /> 数据安全传输 · 巡检记录自动保存</div>
      </div>
    </div>
  );
}
