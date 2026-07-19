import { useEffect, useState } from 'react';
import { Card, Table } from 'antd';
import { fetchFinanceDashboard } from '../../../api/finance';
import type { FinanceDashboard } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';

export default function FinanceDashboardPage() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'super_admin');
  const [data, setData] = useState<FinanceDashboard>();
  useEffect(() => {
    void fetchFinanceDashboard().then(setData);
  }, []);
  const s = data?.summary;
  // 以卡片上同一组金额现场计算，避免旧版接口缺少 varianceRate，
  // 或网关把小数转换为字符串时误显示为 0.00%。
  const income = Number(s?.income ?? 0);
  const poTotalAmount = Number(s?.poTotalAmount ?? 0);
  const varianceRate = poTotalAmount
    ? Math.abs(income - poTotalAmount) / poTotalAmount
    : 0;
  const formatMonth = (value: string) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
    return match ? `${match[1]}年${Number(match[2])}月` : value;
  };
  return (
    <>
      <div className="finance-stat-grid">
        <div className="finance-stat">
          <span>已定价核算收入</span>
          <b className="finance-money">
            ¥ {income.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
          </b>
        </div>
        <div className="finance-stat">
          <span>PO 数量</span>
          <b>{s?.poCount || 0}</b>
        </div>
        <div className="finance-stat">
          <span>案例数量</span>
          <b>{s?.caseCount || 0}</b>
        </div>
        <div className="finance-stat">
          <span>待匹配 PO</span>
          <b>{s?.pendingMatch || 0}</b>
        </div>
        <div className="finance-stat">
          <span>待定价条目</span>
          <b>{s?.pendingPrice || 0}</b>
        </div>
        <div className="finance-stat">
          <span>收入与 PO 偏差率</span>
          <b>{(varianceRate * 100).toFixed(2)}%</b>
        </div>
      </div>
      {isAdmin && <div className="finance-stat-grid finance-profit-grid">
        <div className="finance-stat"><span>绩效支出</span><b>¥ {Number(s?.performanceExpense || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</b></div>
        <div className="finance-stat"><span>其他成本（通用条目估算）</span><b>¥ {Number(s?.otherCost || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</b></div>
        <div className="finance-stat finance-profit"><span>公司毛利</span><b>¥ {Number(s?.grossProfit || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</b></div>
      </div>}
      <div className="finance-stat">
        <span>PO 总金额</span>
        <b className="finance-money">
          ¥ {poTotalAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
        </b>
      </div>
      <Card className="finance-card" title="月度收入趋势">
        <Table
          rowKey="month"
          pagination={false}
          dataSource={data?.trend || []}
          columns={[
            { title: '月份', dataIndex: 'month', render: formatMonth },
            {
              title: '收入',
              dataIndex: 'income',
              render: (v) => (
                <span className="finance-money">
                  ¥ {Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
