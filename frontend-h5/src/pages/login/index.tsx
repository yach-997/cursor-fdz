import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Field, Toast } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import './login.css';

/** PC 入口页地址 */
const PC_PORTAL_URL = import.meta.env.VITE_PC_URL || 'http://localhost:5173/';

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
          <div className="h5-login-brand__logo" aria-hidden>
            <svg viewBox="0 0 48 48" width="32" height="32">
              <circle cx="24" cy="18" r="4" fill="#fff" />
              <path fill="#fff" d="M14 34c2.5-5 6-8 10-8s7.5 3 10 8H14z" opacity="0.9" />
            </svg>
          </div>
          <h1>光伏储能巡检系统</h1>
          <p>H5 巡检端（须具备巡检员角色并已聘到站点）</p>
        </div>

        <div className="h5-login-card">
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
              登录
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
