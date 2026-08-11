import { useEffect, useState } from 'react';
import { Drawer, Empty, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { fetchReviewAmountBreakdown } from '../../../api/finance';
import type { ReviewAmountBreakdown } from '../../../types/finance';
import { useDrawerWidth } from '../../../hooks/useDrawerWidth';

const money = (v: string | number | null | undefined) => `¥${Number(v || 0).toFixed(2)}`;

const expenseStatusTag = (status?: string) => {
  if (status === 'approved') return <Tag color="green">已通过</Tag>;
  if (status === 'rejected') return <Tag color="red">已驳回</Tag>;
  if (status === 'submitted') return <Tag color="gold">待审核</Tag>;
  if (status === 'draft') return <Tag>草稿/无行程</Tag>;
  return <Tag>{status || '-'}</Tag>;
};

type BreakdownItem = ReviewAmountBreakdown['items'][number];

function priceCreatePath(
  type: 'settle' | 'perf',
  row: BreakdownItem,
) {
  const params = new URLSearchParams({
    type,
    add: '1',
    itemCode: row.itemCode || '',
    itemName: row.itemName || row.itemCode || '',
  });
  if (row.unit) params.set('unit', row.unit);
  if (row.itemDesc) params.set('itemDesc', row.itemDesc);
  return `/finance/prices?${params.toString()}`;
}

type Props = {
  open: boolean;
  caseId?: string;
  caseLabel?: string;
  onClose: () => void;
};

export default function SettlementAmountDrawer({ open, caseId, caseLabel, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReviewAmountBreakdown>();
  const drawerWidth = useDrawerWidth(720);

  useEffect(() => {
    if (!open || !caseId) return;
    let cancelled = false;
    setLoading(true);
    void fetchReviewAmountBreakdown(caseId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, caseId]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={drawerWidth}
      title={caseLabel ? `金额明细 · ${caseLabel}` : '金额明细'}
      destroyOnClose
    >
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : !data ? (
        <Empty description="暂无金额明细" />
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            案例收入按结算单价汇总；计件绩效按内部绩效单价汇总；事件扣罚单独登记，三者不是同一套价格。
            缺价处可点击前往价格库补录（会预填条目信息）。
          </Typography.Paragraph>

          <div className="settle-amount-summary">
            <div>
              <span>案例收入</span>
              <strong>{money(data.caseRevenue)}</strong>
              <em>Σ 数量 × 结算单价</em>
            </div>
            <div>
              <span>计件绩效</span>
              <strong>{money(data.perfBase)}</strong>
              <em>Σ 数量 × 绩效单价</em>
            </div>
            <div>
              <span>事件扣罚</span>
              <strong className="is-neg">{money(data.eventPenalty)}</strong>
              <em>本案例已登记合计</em>
            </div>
          </div>

          {Number(data.deduction) > 0 && (
            <Typography.Paragraph type="warning" style={{ marginBottom: 16 }}>
              另有审核扣减 {money(data.deduction)}，计件实得约 {money(data.perfFinal)}
            </Typography.Paragraph>
          )}

          <Typography.Title level={5} style={{ marginTop: 8 }}>
            案例收入明细
          </Typography.Title>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data.items}
            locale={{ emptyText: '无计费条目' }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}>
                  合计
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong>{money(data.caseRevenue)}</strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
            columns={[
              {
                title: '条目',
                dataIndex: 'itemName',
                ellipsis: true,
                render: (v: string, row) => (
                  <Tooltip title={row.itemCode}>
                    <span>{v || row.itemCode}</span>
                  </Tooltip>
                ),
              },
              {
                title: '数量',
                dataIndex: 'qty',
                width: 80,
                render: (v, row) => `${Number(v).toFixed(2)}${row.unit ? ` ${row.unit}` : ''}`,
              },
              {
                title: '结算单价',
                dataIndex: 'settlePrice',
                width: 110,
                align: 'right' as const,
                render: (v, row) =>
                  v == null ? (
                    <Tooltip title="点击前往价格库补甲方结算价">
                      <Link
                        to={priceCreatePath('settle', row)}
                        className="finance-missing-price-link"
                        onClick={onClose}
                      >
                        <span style={{ color: '#b54708' }}>未配</span>
                      </Link>
                    </Tooltip>
                  ) : (
                    money(v)
                  ),
              },
              {
                title: '小计',
                dataIndex: 'itemRevenue',
                width: 110,
                align: 'right' as const,
                render: (v) => money(v),
              },
            ]}
          />

          <Typography.Title level={5} style={{ marginTop: 24 }}>
            计件绩效明细
          </Typography.Title>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data.items}
            locale={{ emptyText: '无计费条目' }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}>
                  合计
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong>{money(data.perfBase)}</strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
            columns={[
              {
                title: '条目',
                dataIndex: 'itemName',
                ellipsis: true,
                render: (v: string, row) => (
                  <Tooltip title={row.itemCode}>
                    <span>{v || row.itemCode}</span>
                  </Tooltip>
                ),
              },
              {
                title: '数量',
                dataIndex: 'qty',
                width: 80,
                render: (v, row) => `${Number(v).toFixed(2)}${row.unit ? ` ${row.unit}` : ''}`,
              },
              {
                title: '绩效单价',
                dataIndex: 'perfPrice',
                width: 110,
                align: 'right' as const,
                render: (v, row) =>
                  v == null ? (
                    <Tooltip title="点击前往价格库补内部绩效价">
                      <Link
                        to={priceCreatePath('perf', row)}
                        className="finance-missing-price-link"
                        onClick={onClose}
                      >
                        <span style={{ color: '#b54708' }}>未配</span>
                      </Link>
                    </Tooltip>
                  ) : (
                    money(v)
                  ),
              },
              {
                title: '小计',
                dataIndex: 'itemPerf',
                width: 110,
                align: 'right' as const,
                render: (v) => money(v),
              },
            ]}
          />

          <Typography.Title level={5} style={{ marginTop: 24 }}>
            事件扣罚
          </Typography.Title>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data.events}
            locale={{ emptyText: '本案例暂无事件扣罚' }}
            columns={[
              {
                title: '内容',
                dataIndex: 'content',
                ellipsis: true,
                render: (v, row) => (
                  <span>
                    {v}
                    {row.remark ? `（${row.remark}）` : ''}
                  </span>
                ),
              },
              {
                title: '扣罚对象',
                dataIndex: 'userName',
                width: 100,
                render: (v) => v || '—',
              },
              {
                title: '金额',
                dataIndex: 'amount',
                width: 100,
                align: 'right' as const,
                render: (v) => <span className="is-neg">{money(v)}</span>,
              },
            ]}
          />

          <Typography.Title level={5} style={{ marginTop: 24 }}>
            行程报销
            {Number(data.pendingExpenseCount || 0) > 0 ? (
              <Typography.Text type="warning" style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>
                待审 {data.pendingExpenseCount} 条
              </Typography.Text>
            ) : null}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            报销在「结算审核 → 行程报销」页签单独核定，与案例结算通过互不影响。
            {Number(data.pendingExpenseCount || 0) > 0 ? (
              <>
                {' '}
                <Link to="/finance/review?scope=expense" onClick={onClose}>
                  去核定报销
                </Link>
              </>
            ) : null}
          </Typography.Paragraph>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data.expenses || []}
            locale={{ emptyText: '本案例暂无行程报销' }}
            columns={[
              {
                title: '工程师',
                dataIndex: 'inspectorName',
                width: 100,
                ellipsis: true,
                render: (v) => v || '—',
              },
              {
                title: '申报/核定',
                width: 130,
                render: (_, row) => {
                  const claim = row.claimAmount ?? row.amount;
                  const approved =
                    row.status === 'approved' ? row.amount : null;
                  return approved != null
                    ? `${money(claim)} → ${money(approved)}`
                    : money(claim);
                },
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (v) => expenseStatusTag(v),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
