import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from 'antd';
import './finance.css';

const tabs = [
  { key: '/finance/dashboard', label: '经营看板' },
  { key: '/finance/cases', label: '案例管理' },
  { key: '/finance/po-orders', label: 'PO 管理' },
  { key: '/finance/prices', label: '价格库' },
  { key: '/finance/review', label: '结算审核' },
  { key: '/finance/assessment', label: '考核管理' },
  { key: '/finance/monthly', label: '月度结算' },
];
export default function FinanceLayout() {
  const location = useLocation(),
    navigate = useNavigate();
  return (
    <div className="finance-shell">
      <div className="finance-heading">
        <div>
          <h2>费用结算中心</h2>
          <p>案例、订单、价格与收入统一核算</p>
        </div>
        <span className="finance-phase">完整结算闭环</span>
      </div>
      <Tabs
        className="finance-tabs"
        activeKey={
          tabs.find((t) => location.pathname.startsWith(t.key))?.key || '/finance/dashboard'
        }
        items={tabs}
        onChange={navigate}
      />
      <Outlet />
    </div>
  );
}
