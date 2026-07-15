import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { getHomePathByRole } from '../../router/menus';
import './portal.css';

/** H5 入口地址（开发默认 5175） */
const IS_LOCAL_HOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const H5_LOGIN_URL = IS_LOCAL_HOST
  ? import.meta.env.VITE_H5_URL || 'http://localhost:5175/m/login'
  : 'https://cursor-fdz-h5.vercel.app/m/login';

/** 入口选择页：按参考图设计的 PC / H5 双入口 */
export default function PortalPage() {
  const navigate = useNavigate();
  const { token, user, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="portal-page">
      <div className="portal-page__inner">
        <div className="portal-brand">
          <div className="portal-brand__logo" aria-hidden>
            <svg viewBox="0 0 48 48" width="36" height="36">
              <path
                fill="#fff"
                d="M24 8c.8 0 1.5.3 2.1.9l1.6 1.6c2.8 2.8 4.3 6.6 4.3 10.5v1c0 1.1-.9 2-2 2h-12c-1.1 0-2-.9-2-2v-1c0-3.9 1.5-7.7 4.3-10.5l1.6-1.6c.6-.6 1.3-.9 2.1-.9zm0 28a4 4 0 100-8 4 4 0 000 8zm-10.5-6.5a1.5 1.5 0 112.1 2.1A11.9 11.9 0 0012 36a12 12 0 0021.5-7.4 1.5 1.5 0 112.9.6A15 15 0 019 36c0 2 .4 3.9 1.1 5.6a1.5 1.5 0 112.7-1.3A11.9 11.9 0 0113.5 29.5z"
              />
              <circle cx="24" cy="18" r="3" fill="#fff" opacity="0.95" />
            </svg>
          </div>
          <h1 className="portal-brand__title">光伏储能巡检系统</h1>
          <p className="portal-brand__subtitle">请选择登录入口</p>
          {token && user && (
            <p className="portal-brand__subtitle" style={{ marginTop: 8, opacity: 0.9 }}>
              当前账号：{user.realName} ·{' '}
              <a
                style={{ color: '#fff', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={() => navigate(getHomePathByRole(user.role))}
              >
                继续进入
              </a>
            </p>
          )}
        </div>

        <button
          type="button"
          className="portal-card"
          onClick={() => navigate('/login')}
        >
          <span className="portal-card__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="26" height="26">
              <rect x="3" y="3" width="8" height="8" rx="1.5" fill="#fff" />
              <rect x="13" y="3" width="8" height="8" rx="1.5" fill="#fff" />
              <rect x="3" y="13" width="8" height="8" rx="1.5" fill="#fff" />
              <rect x="13" y="13" width="8" height="8" rx="1.5" fill="#fff" />
            </svg>
          </span>
          <span className="portal-card__text">
            <span className="portal-card__title">PC 管理后台</span>
            <span className="portal-card__desc">管理员 / 站长入口</span>
          </span>
          <span className="portal-card__arrow">›</span>
        </button>

        <button
          type="button"
          className="portal-card"
          onClick={() => {
            window.location.href = H5_LOGIN_URL;
          }}
        >
          <span className="portal-card__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="26" height="26">
              <rect
                x="7"
                y="2"
                width="10"
                height="20"
                rx="2"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
              />
              <circle cx="12" cy="18" r="1.2" fill="#fff" />
            </svg>
          </span>
          <span className="portal-card__text">
            <span className="portal-card__title">H5 移动端</span>
            <span className="portal-card__desc">巡检员现场巡检入口</span>
          </span>
          <span className="portal-card__arrow">›</span>
        </button>
      </div>
    </div>
  );
}
