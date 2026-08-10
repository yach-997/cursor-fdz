import { useEffect, useState } from 'react';
import { Drawer, Empty, Spin, Table, Tooltip, Typography } from 'antd';
import { fetchReviewAmountBreakdown } from '../../../api/finance';
import type { ReviewAmountBreakdown } from '../../../types/finance';

const money = (v: string | number | null | undefined) => `¥${Number(v || 0).toFixed(2)}`;

type Props = {
  open: boolean;
  caseId?: string;
  caseLabel?: string;
  onClose: () => void;
};

export default function SettlementAmountDrawer({ open, caseId, caseLabel, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReviewAmountBreakdown>();

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
      width={720}
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
                width: 100,
                align: 'right' as const,
                render: (v) => (v == null ? '—' : money(v)),
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
                width: 100,
                align: 'right' as const,
                render: (v) => (v == null ? <span style={{ color: '#b54708' }}>未配</span> : money(v)),
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
        </>
      )}
    </Drawer>
  );
}
