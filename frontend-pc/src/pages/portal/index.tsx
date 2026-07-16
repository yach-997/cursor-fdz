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
            光
          </div>
          <div className="portal-brand__eyebrow">智能能源巡检平台</div>
          <h1 className="portal-brand__title">光伏储能巡检系统</h1>
          <p className="portal-brand__subtitle">为管理与现场巡检提供清晰、可靠的一体化工作台</p>
          {token && user && (
            <p className="portal-brand__subtitle portal-brand__session">
              当前账号：{user.realName} ·{' '}
              <a onClick={() => navigate(getHomePathByRole(user.role))}>继续进入</a>
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
            <span className="portal-card__title">管理后台</span>
            <span className="portal-card__desc">管理员 / 站长 · 电脑与手机均可使用</span>
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
            <span className="portal-card__title">手机巡检端</span>
            <span className="portal-card__desc">巡检员现场巡检入口</span>
          </span>
          <span className="portal-card__arrow">›</span>
        </button>
        <div className="portal-note"><span /> 系统服务正常　·　请根据工作场景选择入口</div>
      </div>
    </div>
  );
}
