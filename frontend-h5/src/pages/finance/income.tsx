import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Loading } from 'react-vant';
import { fetchMyIncome, type MyIncome } from '../../api/finance';
import './finance.css';

const reviewLabel = { pending: '待审核', approved: '已审核', rejected: '已驳回' };
export default function MyIncomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<MyIncome>();
  useEffect(() => { void fetchMyIncome().then(setData); }, []);
  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head"><button onClick={() => navigate('/m/my')}>← 返回</button><h1>我的收入</h1></header>
      {!data ? <Loading vertical>正在核算...</Loading> : <>
        <section className="mobile-finance-card income-hero">
          <span>{data.month} 预计绩效</span><strong>¥ {Number(data.totalAmount).toFixed(2)}</strong>
          <div className="income-grid"><div><b>¥{Number(data.approvedAmount).toFixed(2)}</b><span>已审核</span></div><div><b>¥{Number(data.pendingAmount).toFixed(2)}</b><span>待审核</span></div></div>
        </section>
        {data.assessment && <section className="mobile-finance-card">
          <div className="mobile-finance-row"><h3>本月考核与补助</h3><b>{Number(data.assessment.totalScore).toFixed(1)} 分</b></div>
          <div className="income-item-lines">
            <p><span>排名结果</span><b>{data.assessment.rankResult || '待排名'}</b></p>
            <p><span>考核奖罚</span><b>¥{Number(data.assessment.rewardAmount).toFixed(2)}</b></p>
            <p><span>工具及其他补助</span><b>¥{(Number(data.assessment.toolSubsidy) + Number(data.assessment.otherSubsidy)).toFixed(2)}</b></p>
          </div>
        </section>}
        {data.monthlySettlement && <section className="mobile-finance-card">
          <div className="mobile-finance-row"><span>月度结算金额</span><b>¥{Number(data.monthlySettlement.finalAmount).toFixed(2)}</b></div>
          <p className="mobile-finance-muted">{data.monthlySettlement.status === 'locked' ? '本月已锁定' : '当前为结算预览，锁定前仍可能调整'}</p>
        </section>}
        {!data.list.length ? <Empty description="本月暂无收入明细" /> : data.list.map((item) => (
          <section className="mobile-finance-card" key={item.id}>
            <div className="mobile-finance-row"><h3>{item.serviceCase?.projectName || item.gspCaseNo}</h3><span className="mobile-finance-status">{reviewLabel[item.reviewStatus]}</span></div>
            <p className="mobile-finance-muted">{item.gspCaseNo}</p>
            <div className="mobile-finance-row"><span>应得绩效</span><b>¥{Number(item.perfFinal).toFixed(2)}</b></div>
            {Number(item.deduction) > 0 && <p style={{ color: '#c84b4b' }}>扣减 ¥{Number(item.deduction).toFixed(2)}：{item.deductionReason}</p>}
            <div className="income-item-lines">{item.items.map((line, i) => <p key={`${line.itemName}-${i}`}><span>{line.itemName} × {line.qty}</span><b>¥{Number(line.itemPerf).toFixed(2)}</b></p>)}</div>
          </section>
        ))}
      </>}
    </div>
  );
}
