import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button, Checkbox, Form, Input, message } from 'antd';
import {
  LockOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  CloudSyncOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';
import { getHomePathByRole } from '../../router/menus';
import './login.css';

/** PC 登录页：与入口页统一的薄荷绿风格 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loading, token, user, hydrate, logout } = useAuthStore();
  const [form] = Form.useForm();
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    hydrate();
    const remembered = localStorage.getItem('rememberedUsername');
    if (remembered) {
      form.setFieldsValue({ username: remembered });
      setRemember(true);
    }
  }, [form, hydrate]);

  const onFinish = async (values: { username: string; password: string }) => {
    try {
      const loggedUser = await login(values.username, values.password, remember);
      message.success(`登录成功（${loggedUser.realName}）`);
      navigate(getHomePathByRole(loggedUser.role), { replace: true });
    } catch {
      // 错误已由拦截器提示
    }
  };

  return (
    <div className="pc-login-page">
      <div className="pc-login-shell">
        <section className="pc-login-visual">
          <div className="pc-login-visual__glow" />
          <div className="pc-login-visual__content">
            <div className="pc-login-visual__brand">
              <span className="pc-login-visual__mark">光</span>
              <span>光伏储能巡检云</span>
            </div>
            <div className="pc-login-visual__main">
              <div className="pc-login-visual__eyebrow">Smart Energy Operations</div>
              <h1>让每一次巡检<br />都清晰、可靠、可追溯</h1>
              <p>站点、任务、设备与报告统一管理，让团队专注现场和决策。</p>
              <div className="pc-login-features">
                <div><SafetyCertificateOutlined /><span><b>规范巡检</b><small>流程标准化</small></span></div>
                <div><ThunderboltOutlined /><span><b>高效协同</b><small>多角色联动</small></span></div>
                <div><CloudSyncOutlined /><span><b>数据归档</b><small>全程可追溯</small></span></div>
              </div>
            </div>
            <div className="pc-login-visual__foot">光伏 · 储能 · 安全 · 效率</div>
          </div>
        </section>

        <section className="pc-login-panel">
          <div className="pc-login-card">
            <Link to="/" className="login-back">
              <span className="login-back__arrow" aria-hidden>←</span>
              返回入口
            </Link>

            <div className="pc-login-brand">
              <div className="pc-login-brand__logo" aria-hidden>光</div>
              <div>
                <div className="pc-login-brand__eyebrow">管理工作台</div>
                <h2>欢迎回来</h2>
                <p>请使用站长或管理员账号登录</p>
              </div>
            </div>

            <Form form={form} name="login" onFinish={onFinish} size="large" layout="vertical">
              {token && user && (
                <div className="pc-login-session">
                  当前仍登录为 {user.realName}。可直接切换账号，或{' '}
                  <a onClick={async () => { await logout(); message.info('已退出，请重新登录'); }}>退出当前账号</a>
                </div>
              )}
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input prefix={<UserOutlined />} placeholder="请输入用户名" autoComplete="username" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
              </Form.Item>
              <div className="pc-login-options">
                <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>记住用户名</Checkbox>
                <span>安全加密登录</span>
              </div>
              <Button type="primary" htmlType="submit" block loading={loading} className="pc-login-btn">进入管理端</Button>
            </Form>
            <div className="pc-login-support"><span /> 系统运行正常</div>
          </div>
        </section>
      </div>
    </div>
  );
}
