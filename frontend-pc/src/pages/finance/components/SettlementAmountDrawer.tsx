import { useEffect, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { fetchReviewAmountBreakdown, reviewExpense } from '../../../api/finance';
import type { ReviewAmountBreakdown, ReviewCaseExpense } from '../../../types/finance';
import { displayPhotoUrl } from '../../../utils/photo-url';

const money = (v: string | number | null | undefined) => `¥${Number(v || 0).toFixed(2)}`;

type Props = {
  open: boolean;
  caseId?: string;
  caseLabel?: string;
  onClose: () => void;
  /** 报销核定/驳回后回调（刷新列表徽章等） */
  onChanged?: () => void;
};

function statusTag(status?: string) {
  if (status === 'approved') return <Tag color="green">已通过</Tag>;
  if (status === 'rejected') return <Tag color="red">已驳回</Tag>;
  if (status === 'draft') return <Tag>草稿</Tag>;
  return <Tag color="gold">待审核</Tag>;
}

function VoucherThumbs({ urls }: { urls: string[] }) {
  if (!urls.length) return <span>-</span>;
  const displayUrls = urls.map((url) => displayPhotoUrl(url));
  return (
    <Image.PreviewGroup>
      <Space size={6} align="center">
        <Image
          src={displayUrls[0]}
          width={48}
          height={48}
          style={{ objectFit: 'cover', borderRadius: 8, cursor: 'pointer' }}
        />
        {displayUrls.slice(1).map((url) => (
          <Image key={url} src={url} style={{ display: 'none' }} />
        ))}
        <Tag style={{ marginInlineEnd: 0 }}>共 {urls.length} 张</Tag>
      </Space>
    </Image.PreviewGroup>
  );
}

function collectVouchers(row: ReviewCaseExpense): string[] {
  const urls = [...(row.voucherUrls || [])];
  if (row.startOdometerUrl) urls.push(row.startOdometerUrl);
  if (row.startNavUrl) urls.push(row.startNavUrl);
  if (row.endOdometerUrl) urls.push(row.endOdometerUrl);
  if (row.endNavUrl) urls.push(row.endNavUrl);
  return [...new Set(urls.filter(Boolean))];
}

export default function SettlementAmountDrawer({
  open,
  caseId,
  caseLabel,
  onClose,
  onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReviewAmountBreakdown>();
  const [current, setCurrent] = useState<ReviewCaseExpense>();
  const [action, setAction] = useState<'approve' | 'reject' | 'view'>();
  const [form] = Form.useForm();

  const reload = async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      setData(await fetchReviewAmountBreakdown(caseId));
    } catch {
      setData(undefined);
    } finally {
      setLoading(false);
    }
  };

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

  const submitExpense = async () => {
    if (!current || (action !== 'approve' && action !== 'reject')) return;
    const values = await form.validateFields();
    await reviewExpense(
      current.id,
      action === 'approve',
      action === 'approve' ? values.note : values.reason,
      action === 'approve' ? Number(values.approvedAmount) : undefined,
    );
    message.success(
      action === 'approve'
        ? `已核定报销 ¥${Number(values.approvedAmount).toFixed(2)}`
        : '已驳回报销',
    );
    setCurrent(undefined);
    setAction(undefined);
    form.resetFields();
    await reload();
    onChanged?.();
  };

  const expenses = data?.expenses || [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={820}
      title={caseLabel ? `案例明细 · ${caseLabel}` : '案例明细'}
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
            案例收入按结算单价汇总；计件绩效按内部绩效单价汇总；行程报销按台核定；事件扣罚单独登记。
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
            行程报销（按台）
            {Number(data.pendingExpenseCount || 0) > 0 ? (
              <Tag color="gold" style={{ marginLeft: 8 }}>
                待审 {data.pendingExpenseCount}
              </Tag>
            ) : null}
          </Typography.Title>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={expenses}
            locale={{ emptyText: '本案例暂无行程报销' }}
            scroll={{ x: 720 }}
            columns={[
              {
                title: '台',
                width: 70,
                render: (_, row) =>
                  row.unitSeq != null ? `${row.unitLabel || '台'}#${row.unitSeq}` : '-',
              },
              {
                title: '工程师',
                dataIndex: 'inspectorName',
                width: 90,
                ellipsis: true,
                render: (v, row) => v || row.inspectorId,
              },
              {
                title: '行程',
                width: 80,
                render: (_, row) =>
                  row.tripSkipped ? (
                    <Tag color="orange">无行程</Tag>
                  ) : (
                    <Tag color="blue">有行程</Tag>
                  ),
              },
              {
                title: '申报',
                width: 90,
                render: (_, row) => money(row.claimAmount ?? row.amount),
              },
              {
                title: '核定',
                width: 90,
                render: (_, row) =>
                  row.status === 'approved' ? money(row.amount) : statusTag(row.status),
              },
              {
                title: '里程差',
                width: 80,
                render: (_, row) =>
                  row.mileageKm != null && row.mileageKm !== '' ? `${row.mileageKm} km` : '-',
              },
              {
                title: '凭证',
                width: 140,
                render: (_, row) => <VoucherThumbs urls={collectVouchers(row)} />,
              },
              {
                title: '操作',
                width: 150,
                fixed: 'right',
                render: (_, row) => {
                  if (row.status === 'submitted') {
                    return (
                      <Space>
                        <Button
                          type="link"
                          onClick={() => {
                            setCurrent(row);
                            setAction('approve');
                            form.setFieldsValue({
                              approvedAmount: Number(row.claimAmount ?? row.amount ?? 0),
                              note: undefined,
                            });
                          }}
                        >
                          核定
                        </Button>
                        <Button
                          type="link"
                          danger
                          onClick={() => {
                            setCurrent(row);
                            setAction('reject');
                            form.resetFields();
                          }}
                        >
                          驳回
                        </Button>
                      </Space>
                    );
                  }
                  return (
                    <Button
                      type="link"
                      onClick={() => {
                        setCurrent(row);
                        setAction('view');
                      }}
                    >
                      详情
                    </Button>
                  );
                },
              },
            ]}
          />

          <Typography.Title level={5} style={{ marginTop: 24 }}>
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
                render: (v) =>
                  v == null ? <span style={{ color: '#b54708' }}>未配</span> : money(v),
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

      <Modal
        open={!!current && !!action}
        title={
          action === 'approve'
            ? '核定通过本台报销'
            : action === 'reject'
              ? '驳回本台报销'
              : '行程报销详情'
        }
        onCancel={() => {
          setCurrent(undefined);
          setAction(undefined);
        }}
        onOk={action === 'view' ? undefined : () => void submitExpense()}
        footer={
          action === 'view'
            ? [
                <Button
                  key="close"
                  type="primary"
                  onClick={() => {
                    setCurrent(undefined);
                    setAction(undefined);
                  }}
                >
                  关闭
                </Button>,
              ]
            : undefined
        }
        okText={action === 'approve' ? '确认核定通过' : '确认驳回'}
        okButtonProps={{ danger: action === 'reject' }}
        width={640}
        destroyOnClose
      >
        {current && (
          <>
            <p style={{ color: '#61756b' }}>
              {current.unitSeq != null
                ? `${current.unitLabel || '台'} #${current.unitSeq}`
                : '未分台'}{' '}
              · {current.inspectorName || current.inspectorId} · 申报{' '}
              {money(current.claimAmount ?? current.amount)}
            </p>
            {current.note ? <p>备注：{current.note}</p> : null}
            <div style={{ marginBottom: 12 }}>
              <VoucherThumbs urls={collectVouchers(current)} />
            </div>
            {action !== 'view' && (
              <Form form={form} layout="vertical">
                {action === 'approve' ? (
                  <>
                    <Form.Item
                      name="approvedAmount"
                      label="核定报销金额（元）"
                      rules={[{ required: true, message: '请填写核定金额' }]}
                      extra="可按凭证改为实际可报金额"
                    >
                      <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="note" label="备注（选填）">
                      <Input.TextArea rows={2} placeholder="可选审核说明" />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item
                    name="reason"
                    label="驳回原因"
                    rules={[{ required: true, message: '请填写驳回原因' }]}
                  >
                    <Input.TextArea rows={3} placeholder="请说明驳回原因" />
                  </Form.Item>
                )}
              </Form>
            )}
          </>
        )}
      </Modal>
    </Drawer>
  );
}
