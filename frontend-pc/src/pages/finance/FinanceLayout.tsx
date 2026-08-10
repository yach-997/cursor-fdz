import { Outlet, useLocation } from 'react-router-dom';
import './finance.css';

const pageMeta: Array<{ prefix: string; title: string; desc: string }> = [
  { prefix: '/finance/dashboard', title: '经营看板', desc: '收入、绩效与结算进度总览' },
  { prefix: '/finance/cases', title: '案例管理', desc: '导入案例、派网格与工程师作业' },
  { prefix: '/finance/po-orders', title: 'PO 管理', desc: '甲方订单与案例价格关联' },
  { prefix: '/finance/prices', title: '价格库', desc: '内部绩效价与甲方结算价维护' },
  { prefix: '/finance/review', title: '结算审核', desc: '按案例统一审核计件结算与行程报销' },
  { prefix: '/finance/assessment', title: '考核管理', desc: '打分排名与奖罚补助' },
  { prefix: '/finance/monthly', title: '月度结算', desc: '按月汇总结算单；网格长只读本网格' },
];

export default function FinanceLayout() {
  const location = useLocation();
  const meta =
    pageMeta.find((item) => location.pathname.startsWith(item.prefix)) || {
      title: '费用结算',
      desc: '案例、订单、价格与收入统一核算',
    };

  return (
    <div className="finance-shell">
      <div className="finance-heading">
        <div>
          <h2>{meta.title}</h2>
          <p>{meta.desc}</p>
        </div>
        <span className="finance-phase">费用结算</span>
      </div>
      <Outlet />
    </div>
  );
}
