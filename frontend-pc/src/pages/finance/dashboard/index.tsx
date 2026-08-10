import { useEffect, useState } from 'react';
import { Alert, Button, Card, Drawer, Space, Table, Tag, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { fetchFinanceDashboard, fetchFinanceVarianceDetail } from '../../../api/finance';
import type { FinanceDashboard, FinanceVarianceDetail } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';

const moneyText = (value: number) =>
  `¥ ${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;

export default function FinanceDashboardPage() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((state) => state.user?.role === 'super_admin');
  const [data, setData] = useState<FinanceDashboard>();
  const [varianceOpen, setVarianceOpen] = useState(false);
  const [varianceLoading, setVarianceLoading] = useState(false);
  const [variance, setVariance] = useState<FinanceVarianceDetail>();

  useEffect(() => {
    void fetchFinanceDashboard().then(setData);
  }, []);

  const openVariance = async () => {
    setVarianceOpen(true);
    setVarianceLoading(true);
    try {
      setVariance(await fetchFinanceVarianceDetail());
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载偏差明细失败');
    } finally {
      setVarianceLoading(false);
    }
  };

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
  const vs = variance?.summary;

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
          <span>忽略条目（明细行）</span>
          <b>{s?.ignoredCount || 0}</b>
        </div>
        <div
          className="finance-stat finance-stat-clickable"
          onClick={() => void openVariance()}
          title="点击查看偏差明细"
        >
          <span>收入与 PO 偏差率</span>
          <b>{(varianceRate * 100).toFixed(2)}%</b>
          <em>点击查看明细</em>
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
              <p style={{ marginBottom: 8 }}>
                已定价 {s?.okCount || 0} 条 · 待定价 {s?.pendingPrice || 0} 条 · 忽略{' '}
                {s?.ignoredCount || 0} 条（名称仅为「无」「自定义」的明细不计入核算）。
              </p>
              <Button type="link" style={{ padding: 0 }} onClick={() => void openVariance()}>
                查看偏差明细（差在哪些案例/PO）
              </Button>
            </div>
          }
        />
      )}

      <Card className="finance-card" title="忽略条目汇总（按名称；不计入核算收入）" style={{ marginTop: 16 }}>
        <Table
          rowKey="itemCode"
          size="small"
          pagination={false}
          locale={{ emptyText: '当前没有忽略条目' }}
          dataSource={ignoredItems}
          columns={[
            { title: 'PO 条目名称', dataIndex: 'itemCode' },
            { title: '明细条数', dataIndex: 'count', width: 100 },
            {
              title: '数量合计',
              dataIndex: 'qty',
              width: 120,
              render: (v) => Number(v).toFixed(2),
            },
          ]}
        />
        {ignoredItems.length > 0 && (
          <p className="finance-tip" style={{ marginTop: 12, marginBottom: 0 }}>
            上表按名称汇总；看板「忽略条目（明细行）」= 各名称「明细条数」相加（例如「无」+「自定义」共{' '}
            {ignoredItems.reduce((sum, row) => sum + Number(row.count || 0), 0)} 条）。
          </p>
        )}
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

      <Drawer
        width={920}
        open={varianceOpen}
        onClose={() => setVarianceOpen(false)}
        title="收入与 PO 偏差明细"
        extra={
          <Space>
            {isAdmin && (
              <Button onClick={() => navigate('/finance/prices')}>去价格库定价</Button>
            )}
            <Button onClick={() => navigate('/finance/po-orders')}>看待匹配 PO</Button>
          </Space>
        }
      >
        {vs && (
          <>
            <Alert
              showIcon
              type={Math.abs(vs.varianceAmount) > 0 ? 'warning' : 'success'}
              style={{ marginBottom: 16 }}
              message="怎么算的"
              description={
                <div>
                  PO 总额 {moneyText(vs.poTotalAmount)} − 已定价核算收入 {moneyText(vs.income)} ＝
                  差额 {moneyText(Math.abs(vs.varianceAmount))}（偏差率{' '}
                  {(vs.varianceRate * 100).toFixed(2)}%）
                  <div style={{ marginTop: 8, color: '#666' }}>
                    已定价 {vs.okCount} 条 · 待定价 {vs.pendingPrice} 条 · 忽略 {vs.ignoredCount} 条 ·
                    未匹配 PO {vs.unmatchedPoCount} 单
                  </div>
                </div>
              }
            />
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              loading={varianceLoading}
              style={{ marginBottom: 20 }}
              dataSource={variance?.buckets || []}
              columns={[
                { title: '偏差构成', dataIndex: 'label', width: 180 },
                {
                  title: '金额',
                  dataIndex: 'amount',
                  width: 140,
                  render: (v, row) =>
                    row.key === 'pending_price' || row.key === 'ignored'
                      ? '-'
                      : moneyText(Number(v)),
                },
                { title: '数量', dataIndex: 'count', width: 90 },
                { title: '说明', dataIndex: 'tip' },
              ]}
            />
            <Card size="small" title="有缺口的案例（按差额从大到小）" style={{ marginBottom: 16 }}>
              <Table
                rowKey="caseId"
                size="small"
                loading={varianceLoading}
                pagination={{ pageSize: 8 }}
                dataSource={variance?.cases || []}
                locale={{ emptyText: '暂无案例缺口' }}
                columns={[
                  { title: '案例号', dataIndex: 'gspCaseNo', width: 140 },
                  { title: '项目', dataIndex: 'projectName', ellipsis: true },
                  {
                    title: 'PO 金额',
                    dataIndex: 'poTotalAmount',
                    width: 110,
                    render: (v) => moneyText(v),
                  },
                  {
                    title: '核算收入',
                    dataIndex: 'caseRevenue',
                    width: 110,
                    render: (v) => moneyText(v),
                  },
                  {
                    title: '差额',
                    dataIndex: 'gap',
                    width: 110,
                    render: (v) => (
                      <span style={{ color: Number(v) > 0 ? '#cf1322' : undefined }}>
                        {moneyText(v)}
                      </span>
                    ),
                  },
                  {
                    title: '待定价/忽略',
                    width: 110,
                    render: (_, row) => `${row.pendingPrice}/${row.ignoredCount}`,
                  },
                  {
                    title: '原因',
                    dataIndex: 'reason',
                    width: 160,
                    render: (v) => <Tag color="orange">{v}</Tag>,
                  },
                  {
                    title: '操作',
                    width: 80,
                    render: (_, row) => (
                      <Button
                        type="link"
                        onClick={() => navigate(`/finance/cases?keyword=${encodeURIComponent(row.gspCaseNo)}`)}
                      >
                        查看
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
            <Card size="small" title="未匹配案例的 PO（全部计入 PO 总额，未进核算收入）">
              <Table
                rowKey="id"
                size="small"
                loading={varianceLoading}
                pagination={{ pageSize: 8 }}
                dataSource={variance?.unmatchedPos || []}
                locale={{ emptyText: '暂无未匹配 PO' }}
                columns={[
                  { title: 'PO 号', dataIndex: 'poNo', width: 140 },
                  { title: 'GSP 案例号', dataIndex: 'gspCaseNo', width: 140 },
                  { title: '项目', dataIndex: 'projectName', ellipsis: true },
                  {
                    title: 'PO 金额',
                    dataIndex: 'poTotalAmount',
                    width: 120,
                    render: (v) => moneyText(v),
                  },
                  {
                    title: '状态',
                    dataIndex: 'matchStatus',
                    width: 100,
                    render: (v) => (v === 'pending' ? <Tag color="gold">待匹配</Tag> : <Tag>{v}</Tag>),
                  },
                ]}
              />
            </Card>
          </>
        )}
      </Drawer>
    </>
  );
}
