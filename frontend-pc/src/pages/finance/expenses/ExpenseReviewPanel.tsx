import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { fetchPendingExpenses, reviewExpense } from '../../../api/finance';
import { displayPhotoUrl } from '../../../utils/photo-url';
import { useDrawerWidth } from '../../../hooks/useDrawerWidth';

export type ExpenseReviewItem = {
  id: string;
  serviceCaseId: string;
  workUnitId?: string | null;
  unitSeq?: number | null;
  unitLabel?: string | null;
  gspCaseNo?: string;
  projectName?: string;
  inspectorId: string;
  inspectorName?: string;
  amount: string;
  claimAmount?: string;
  note?: string | null;
  voucherUrls?: string[];
  startOdometerUrl?: string | null;
  startNavUrl?: string | null;
  startNavUrls?: string[];
  startMileage?: string | null;
  endOdometerUrl?: string | null;
  endNavUrl?: string | null;
  endNavUrls?: string[];
  endMileage?: string | null;
  mileageKm?: string | null;
  tripSkipped?: boolean;
  caseExpenseTotal?: string;
  status: string;
  month?: string | null;
  reviewNote?: string | null;
  reviewAt?: string | null;
  createdAt?: string;
};

type ExpenseTab = 'pending' | 'approved' | 'rejected' | 'all';

const tabLabel: Record<ExpenseTab, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  all: '全部',
};

const statusTag = (status?: string) => {
  if (status === 'approved') return <Tag color="green">已通过</Tag>;
  if (status === 'rejected') return <Tag color="red">已驳回</Tag>;
  if (status === 'draft') return <Tag>草稿</Tag>;
  return <Tag color="gold">待审核</Tag>;
};

function VoucherGallery({
  urls,
  coverSize = 56,
  showAllInGrid = false,
}: {
  urls: string[];
  coverSize?: number;
  showAllInGrid?: boolean;
}) {
  if (!urls.length) return <span>-</span>;
  const displayUrls = urls.map((url) => displayPhotoUrl(url));
  if (showAllInGrid) {
    return (
      <Image.PreviewGroup>
        <Space wrap size={8}>
          {displayUrls.map((url) => (
            <Image
              key={url}
              src={url}
              width={96}
              height={96}
              style={{ objectFit: 'cover', borderRadius: 8 }}
            />
          ))}
        </Space>
      </Image.PreviewGroup>
    );
  }
  return (
    <Image.PreviewGroup>
      <Space size={6} align="center">
        <Image
          src={displayUrls[0]}
          width={coverSize}
          height={coverSize}
          style={{ objectFit: 'cover', borderRadius: 8, cursor: 'pointer' }}
        />
        {displayUrls.slice(1).map((url) => (
          <Image key={url} src={url} style={{ display: 'none' }} />
        ))}
        <Tag style={{ marginInlineEnd: 0 }}>共 {urls.length} 张 · 点击查看</Tag>
      </Space>
    </Image.PreviewGroup>
  );
}

function PhotoBlock({ label, urls }: { label: string; urls: string[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 6, fontWeight: 500 }}>{label}</div>
      {urls.length ? (
        <VoucherGallery urls={urls} showAllInGrid />
      ) : (
        <span style={{ color: '#98a29c' }}>未上传</span>
      )}
    </div>
  );
}

function evidenceUrls(row: ExpenseReviewItem): string[] {
  const startNav =
    row.startNavUrls?.length
      ? row.startNavUrls
      : row.startNavUrl
        ? [row.startNavUrl]
        : [];
  const endNav =
    row.endNavUrls?.length ? row.endNavUrls : row.endNavUrl ? [row.endNavUrl] : [];
  return [
    row.startOdometerUrl,
    ...startNav,
    row.endOdometerUrl,
    ...endNav,
    ...(row.voucherUrls || []),
  ].filter((u): u is string => !!u);
}

type Props = {
  /** 审核后回调（用于刷新侧栏待审数量等） */
  onChanged?: () => void;
};

/** 行程报销审核面板（嵌入结算审核页） */
export default function ExpenseReviewPanel({ onChanged }: Props) {
  const [tab, setTab] = useState<ExpenseTab>('pending');
  const [keyword, setKeyword] = useState('');
  const [month, setMonth] = useState<string>();
  const [rows, setRows] = useState<ExpenseReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<ExpenseReviewItem>();
  const [action, setAction] = useState<'approve' | 'reject' | 'view'>();
  const [form] = Form.useForm();
  const modalWidth = useDrawerWidth(720);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        (await fetchPendingExpenses({
          status: tab,
          keyword: keyword.trim() || undefined,
          month: month || undefined,
        })) as ExpenseReviewItem[],
      );
    } finally {
      setLoading(false);
    }
  }, [tab, keyword, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
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
    if (action === 'approve') setTab('approved');
    else setTab('rejected');
    onChanged?.();
  };

  const emptyText = useMemo(() => {
    if (tab === 'approved') return '暂无已通过报销';
    if (tab === 'rejected') return '暂无已驳回报销';
    if (tab === 'all') return '暂无报销记录';
    return '暂无待审核报销';
  }, [tab]);

  const columns: ColumnsType<ExpenseReviewItem> = [
    {
      title: '案例号',
      dataIndex: 'gspCaseNo',
      width: 140,
      render: (v, r) => v || r.serviceCaseId,
    },
    {
      title: '台',
      dataIndex: 'unitSeq',
      width: 70,
      render: (v, r) => (v != null ? `${r.unitLabel || '台'}#${v}` : '-'),
    },
    {
      title: '工程师',
      dataIndex: 'inspectorName',
      width: 100,
      render: (v, r) => v || r.inspectorId,
    },
    {
      title: '行程',
      dataIndex: 'tripSkipped',
      width: 90,
      render: (v: boolean, r) =>
        v ? (
          <Tag color="orange">无行程</Tag>
        ) : r.startOdometerUrl || r.startMileage ? (
          <Tag color="blue">有行程</Tag>
        ) : (
          '-'
        ),
    },
    {
      title: '申报',
      dataIndex: 'claimAmount',
      width: 90,
      render: (v, r) => `¥${Number(v ?? r.amount ?? 0).toFixed(2)}`,
    },
    {
      title: '核定/金额',
      dataIndex: 'amount',
      width: 100,
      render: (v, r) =>
        r.status === 'approved'
          ? `¥${Number(v || 0).toFixed(2)}`
          : `申报 ¥${Number(r.claimAmount ?? v ?? 0).toFixed(2)}`,
    },
    {
      title: '案例合计',
      dataIndex: 'caseExpenseTotal',
      width: 100,
      render: (v) => `¥${Number(v || 0).toFixed(2)}`,
    },
    {
      title: '里程差',
      dataIndex: 'mileageKm',
      width: 90,
      render: (v) => (v != null && v !== '' ? `${v} km` : '-'),
    },
    {
      title: '凭证',
      width: 180,
      render: (_, r) => {
        const urls = evidenceUrls(r);
        return urls.length ? <VoucherGallery urls={urls} /> : '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => statusTag(v),
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_, r) => {
        if (r.status === 'submitted') {
          return (
            <Space>
              <Button
                type="link"
                onClick={() => {
                  setCurrent(r);
                  setAction('approve');
                  form.setFieldsValue({
                    approvedAmount: Number(r.claimAmount ?? r.amount ?? 0),
                    note: undefined,
                  });
                }}
              >
                核定通过
              </Button>
              <Button
                type="link"
                danger
                onClick={() => {
                  setCurrent(r);
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
              setCurrent(r);
              setAction('view');
            }}
          >
            详情
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <p style={{ color: '#61756b', margin: 0 }}>
          按台审核。工程师可在作业中先填报；案例完工后，已提交的行程报销才会进入待审。申报金额可改核定（如报100核定80）；通过后以核定金额计入月结。里程差仅参考。
        </p>
        <Button onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </div>
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as ExpenseTab)}
        items={(Object.keys(tabLabel) as ExpenseTab[]).map((key) => ({
          key,
          label: tabLabel[key],
        }))}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="案例号 / 项目 / 说明"
          style={{ width: 240 }}
          onSearch={(v) => setKeyword(v)}
          onChange={(e) => {
            if (!e.target.value) setKeyword('');
          }}
        />
        <Input
          type="month"
          allowClear
          value={month}
          onChange={(e) => setMonth(e.target.value || undefined)}
          style={{ width: 160 }}
          placeholder="计入月份"
        />
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText }}
      />

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
        onOk={action === 'view' ? undefined : () => void submit()}
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
        width={modalWidth}
        destroyOnClose
      >
        {current && (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="案例">
                {current.gspCaseNo || current.serviceCaseId}
              </Descriptions.Item>
              <Descriptions.Item label="台">
                {current.unitSeq != null
                  ? `${current.unitLabel || '台'} #${current.unitSeq}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="工程师">
                {current.inspectorName || current.inspectorId}
              </Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(current.status)}</Descriptions.Item>
              <Descriptions.Item label="行程标记">
                {current.tripSkipped ? (
                  <Tag color="orange">无行程</Tag>
                ) : (
                  <Tag color="blue">有行程</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="申报金额">
                ¥{Number(current.claimAmount ?? current.amount ?? 0).toFixed(2)}
              </Descriptions.Item>
              <Descriptions.Item label="当前金额/核定">
                ¥{Number(current.amount || 0).toFixed(2)}
              </Descriptions.Item>
              <Descriptions.Item label="案例合计">
                ¥{Number(current.caseExpenseTotal || 0).toFixed(2)}
              </Descriptions.Item>
              <Descriptions.Item label="里程差（参考）">
                {current.mileageKm != null ? `${current.mileageKm} km` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="开始里程">
                {current.startMileage != null ? `${current.startMileage} km` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="结束里程">
                {current.endMileage != null ? `${current.endMileage} km` : '-'}
              </Descriptions.Item>
            </Descriptions>
            {current.note ? (
              <p style={{ color: '#61756b' }}>备注：{current.note}</p>
            ) : null}
            {current.reviewNote ? (
              <p style={{ color: '#61756b' }}>审核说明：{current.reviewNote}</p>
            ) : null}
            <PhotoBlock
              label="开始里程表"
              urls={current.startOdometerUrl ? [current.startOdometerUrl] : []}
            />
            <PhotoBlock
              label="开始导航"
              urls={
                current.startNavUrls?.length
                  ? current.startNavUrls
                  : current.startNavUrl
                    ? [current.startNavUrl]
                    : []
              }
            />
            <PhotoBlock
              label="结束里程表"
              urls={current.endOdometerUrl ? [current.endOdometerUrl] : []}
            />
            <PhotoBlock
              label="结束导航"
              urls={
                current.endNavUrls?.length
                  ? current.endNavUrls
                  : current.endNavUrl
                    ? [current.endNavUrl]
                    : []
              }
            />
            <PhotoBlock label="费用凭证" urls={current.voucherUrls || []} />
            {action !== 'view' && (
              <Form form={form} layout="vertical">
                {action === 'approve' ? (
                  <>
                    <Form.Item
                      name="approvedAmount"
                      label="核定报销金额（元）"
                      rules={[{ required: true, message: '请填写核定金额' }]}
                      extra="可按凭证改为实际可报金额，例如申报100核定80"
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
    </div>
  );
}
