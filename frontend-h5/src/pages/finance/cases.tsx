import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Loading } from 'react-vant';
import { fetchMyFinanceCases, type MobileFinanceCase } from '../../api/finance';
import './finance.css';

const labels: Record<string, string> = {
  assigned: '待开始', working: '作业中', finished: '已完工', settle_review: '待结算审核', settled: '已结算', month_locked: '已月结',
};
export default function FinanceCasesPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<MobileFinanceCase[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void fetchMyFinanceCases().then(setList).finally(() => setLoading(false)); }, []);
  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head"><button onClick={() => navigate('/m/my')}>← 返回</button><h1>费用案例</h1></header>
      {loading ? <div style={{ textAlign: 'center', paddingTop: 100 }}><Loading vertical>加载中...</Loading></div> : !list.length ? <Empty description="暂无派给你的费用案例" /> : list.map((item) => (
        <button key={item.id} className="mobile-finance-card mobile-finance-list-item" onClick={() => navigate(`/m/finance-cases/${item.id}`)}>
          <div className="mobile-finance-row"><h3>{item.projectName}</h3><span className="mobile-finance-status">{labels[item.status] || item.status}</span></div>
          <div className="mobile-finance-muted">{item.gspCaseNo} · {item.province || '未填写省份'}</div>
        </button>
      ))}
    </div>
  );
}
