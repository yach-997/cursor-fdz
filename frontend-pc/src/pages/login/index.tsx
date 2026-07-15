import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button, Checkbox, Form, Input, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
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
      <div className="pc-login-card">
        <Link to="/" className="login-back">
          <span className="login-back__arrow" aria-hidden>
            ←
          </span>
          返回入口
        </Link>

        <div className="pc-login-brand">
          <div className="pc-login-brand__logo" aria-hidden>
            <svg viewBox="0 0 48 48" width="28" height="28">
              <circle cx="24" cy="18" r="4" fill="#fff" />
              <path
                fill="#fff"
                d="M14 34c2.5-5 6-8 10-8s7.5 3 10 8H14z"
                opacity="0.9"
              />
            </svg>
          </div>
          <h1>光伏储能巡检系统</h1>
          <p>PC 管理端（站长 / 副站长 / 超管）</p>
        </div>

        <Form form={form} name="login" onFinish={onFinish} size="large" layout="vertical">
          {token && user && (
            <div style={{ marginBottom: 12, fontSize: 13, color: '#666' }}>
              当前仍登录为 {user.realName}（{user.role === 'super_admin' ? '超级管理员' : user.role === 'site_manager' ? '站长' : '巡检员'}）。
              直接输入其他账号可切换；或{' '}
              <a
                onClick={async () => {
                  await logout();
                  message.info('已退出，请重新登录');
                }}
              >
                退出当前账号
              </a>
            </div>
          )}
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
              记住用户名
            </Checkbox>
          </Form.Item>
          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" block loading={loading} className="pc-login-btn">
              登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
