import { useEffect, useState } from 'react';
import { Alert, Card, Table } from 'antd';
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
  const income = Number(s?.income ?? 0);
  const poTotalAmount = Number(s?.poTotalAmount ?? 0);
  const varianceAmount = Number(
    s?.varianceAmount ?? Math.round((poTotalAmount - income) * 100) / 100,
  );
  const varianceRate = poTotalAmount ? Math.abs(income - poTotalAmount) / poTotalAmount : 0;
  const formatMonth = (value: string) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
    return match ? `${match[1]}年${Number(match[2])}月` : value;
  };
  const ignoredItems = data?.ignoredItems || [];
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
          <span>忽略条目</span>
          <b>{s?.ignoredCount || 0}</b>
        </div>
        <div className="finance-stat">
          <span>收入与 PO 偏差率</span>
          <b>{(varianceRate * 100).toFixed(2)}%</b>
        </div>
      </div>
      {isAdmin && (
        <div className="finance-stat-grid finance-profit-grid">
          <div className="finance-stat">
            <span>绩效支出</span>
            <b>
              ¥{' '}
              {Number(s?.performanceExpense || 0).toLocaleString('zh-CN', {
                minimumFractionDigits: 2,
              })}
            </b>
          </div>
          <div className="finance-stat">
            <span>其他成本（通用条目估算）</span>
            <b>
              ¥ {Number(s?.otherCost || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
            </b>
          </div>
          <div className="finance-stat finance-profit">
            <span>公司毛利</span>
            <b>
              ¥ {Number(s?.grossProfit || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
            </b>
          </div>
        </div>
      )}
      <div className="finance-stat">
        <span>PO 总金额</span>
        <b className="finance-money">
          ¥ {poTotalAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
        </b>
      </div>

      {(varianceAmount !== 0 || (s?.ignoredCount || 0) > 0 || (s?.pendingPrice || 0) > 0) && (
        <Alert
          showIcon
          style={{ margin: '16px 0' }}
          type={(s?.pendingPrice || 0) > 0 ? 'warning' : 'info'}
          message="收入与 PO 总额差异说明"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>
                PO 总额 ¥{poTotalAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} −
                核算收入 ¥{income.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} ＝ 差额 ¥
                {Math.abs(varianceAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}（
                {(varianceRate * 100).toFixed(2)}%）
              </p>
              <p style={{ marginBottom: 0 }}>
                已定价 {s?.okCount || 0} 条 · 待定价 {s?.pendingPrice || 0} 条 · 忽略{' '}
                {s?.ignoredCount || 0} 条（名称仅为「无」「自定义」的明细不计入核算）。若仍有待定价，请到「价格库
                → 批量映射维护」处理；忽略项可在下方列表或案例详情中查看。
              </p>
            </div>
          }
        />
      )}

      <Card className="finance-card" title="忽略条目汇总（不计入核算收入）" style={{ marginTop: 16 }}>
        <Table
          rowKey="itemCode"
          size="small"
          pagination={false}
          locale={{ emptyText: '当前没有忽略条目' }}
          dataSource={ignoredItems}
          columns={[
            { title: 'PO 条目名称', dataIndex: 'itemCode' },
            { title: '出现次数', dataIndex: 'count', width: 100 },
            {
              title: '数量合计',
              dataIndex: 'qty',
              width: 120,
              render: (v) => Number(v).toFixed(2),
            },
          ]}
        />
      </Card>

      <Card className="finance-card" title="月度收入趋势" style={{ marginTop: 16 }}>
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
