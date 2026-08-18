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
import DayDatePicker from '../../../components/DayDatePicker';

export type ExpenseReviewItem = {
  id: string;
  serviceCaseId: string;
  workUnitId?: string | null;
  unitSeq?: number | null;
  unitLabel?: string | null;
  /** 该工程师在本案例完成/已交台数（报销按人，不用台#） */
  completedUnits?: number | null;
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
  lineItems?: Array<{
    id?: string;
    type?: string;
    content?: string;
    expenseDate?: string | null;
    amount?: string | number | null;
    note?: string | null;
    startOdometerUrl?: string | null;
    startMileage?: string | number | null;
    startNavShots?: Array<{ url: string; remark?: string }>;
    endOdometerUrl?: string | null;
    endMileage?: string | number | null;
    endNavShots?: Array<{ url: string; remark?: string }>;
    mileageKm?: string | number | null;
    voucherUrls?: string[];
    photoUrls?: string[];
  }>;
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

type TripMileageSummary = {
  tripCount: number;
  totalKm: number | null;
  startMileage: string | null;
  endMileage: string | null;
};

function tripMileageSummary(row: ExpenseReviewItem): TripMileageSummary {
  const trips = (row.lineItems || []).filter((l) => l.type === 'trip');
  if (trips.length) {
    let total = 0;
    let hasKm = false;
    let minStart: number | null = null;
    let maxEnd: number | null = null;
    for (const trip of trips) {
      const startM =
        trip.startMileage != null && trip.startMileage !== ''
          ? Number(trip.startMileage)
          : NaN;
      const endM =
        trip.endMileage != null && trip.endMileage !== ''
          ? Number(trip.endMileage)
          : NaN;
      if (Number.isFinite(startM)) {
        minStart = minStart == null ? startM : Math.min(minStart, startM);
      }
      if (Number.isFinite(endM)) {
        maxEnd = maxEnd == null ? endM : Math.max(maxEnd, endM);
      }
      let km: number | null = null;
      if (trip.mileageKm != null && trip.mileageKm !== '') {
        const n = Number(trip.mileageKm);
        if (Number.isFinite(n)) km = n;
      } else if (Number.isFinite(startM) && Number.isFinite(endM) && endM >= startM) {
        km = Math.round((endM - startM) * 10) / 10;
      }
      if (km != null) {
        total += km;
        hasKm = true;
      }
    }
    return {
      tripCount: trips.length,
      totalKm: hasKm ? Math.round(total * 10) / 10 : null,
      startMileage: minStart != null ? minStart.toFixed(1) : null,
      endMileage: maxEnd != null ? maxEnd.toFixed(1) : null,
    };
  }
  const fallbackKm =
    row.mileageKm != null && row.mileageKm !== '' ? Number(row.mileageKm) : NaN;
  const hasLegacy = !!(
    row.startMileage ||
    row.endMileage ||
    (row.mileageKm != null && row.mileageKm !== '')
  );
  return {
    tripCount: hasLegacy ? 1 : 0,
    totalKm: Number.isFinite(fallbackKm) ? fallbackKm : null,
    startMileage: row.startMileage ?? null,
    endMileage: row.endMileage ?? null,
  };
}

function formatMileageLabel(summary: TripMileageSummary): string {
  if (summary.tripCount <= 0) return '-';
  if (summary.totalKm == null) {
    return summary.tripCount > 1 ? `共${summary.tripCount}段` : '-';
  }
  if (summary.tripCount > 1) {
    return `共${summary.tripCount}段 ${summary.totalKm} km`;
  }
  return `${summary.totalKm} km`;
}

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
  const fromLines = (row.lineItems || []).flatMap((line) => [
    line.startOdometerUrl,
    ...(line.startNavShots || []).map((s) => s.url),
    line.endOdometerUrl,
    ...(line.endNavShots || []).map((s) => s.url),
    ...(line.voucherUrls || []),
    ...(line.photoUrls || []),
  ]);
  const startNav =
    row.startNavUrls?.length
      ? row.startNavUrls
      : row.startNavUrl
        ? [row.startNavUrl]
        : [];
  const endNav =
    row.endNavUrls?.length ? row.endNavUrls : row.endNavUrl ? [row.endNavUrl] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [
    ...fromLines,
    row.startOdometerUrl,
    ...startNav,
    row.endOdometerUrl,
    ...endNav,
    ...(row.voucherUrls || []),
  ]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
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
      title: '完成台数',
      dataIndex: 'completedUnits',
      width: 90,
      render: (v, r) => {
        const n = Number(v || 0);
        const label = r.unitLabel || '台';
        return n > 0 ? `${n}${label}` : '-';
      },
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
      width: 110,
      render: (v: boolean, r) => {
        if (v) return <Tag color="orange">无行程</Tag>;
        const summary = tripMileageSummary(r);
        if (summary.tripCount > 1) {
          return <Tag color="blue">{summary.tripCount}段行程</Tag>;
        }
        if (summary.tripCount === 1 || r.startOdometerUrl || r.startMileage) {
          return <Tag color="blue">有行程</Tag>;
        }
        return '-';
      },
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
      width: 130,
      render: (_, r) => formatMileageLabel(tripMileageSummary(r)),
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
          按工程师审核。每人每案例一条报销单，可含多条费用明细（行程、过路费等）；工程师可在作业详情按需填报。案例完工后，已提交的报销才会进入待审。申报金额可改核定（如报100核定80）；通过后以核定金额计入月结。里程差按行程段合计，仅供参考。
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
        <DayDatePicker
          allowClear
          value={month}
          onChange={setMonth}
          placeholder="完工日期"
          title="完工日期"
          style={{ width: 160 }}
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
            ? '核定通过本报销'
            : action === 'reject'
              ? '驳回本报销'
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
        {current && (() => {
          const summary = tripMileageSummary(current);
          return (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="案例">
                {current.gspCaseNo || current.serviceCaseId}
              </Descriptions.Item>
              <Descriptions.Item label="完成台数">
                {Number(current.completedUnits || 0) > 0
                  ? `${current.completedUnits}${current.unitLabel || '台'}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="工程师">
                {current.inspectorName || current.inspectorId}
              </Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(current.status)}</Descriptions.Item>
              <Descriptions.Item label="行程标记">
                {current.tripSkipped ? (
                  <Tag color="orange">无行程</Tag>
                ) : summary.tripCount > 1 ? (
                  <Tag color="blue">{summary.tripCount}段行程</Tag>
                ) : summary.tripCount === 1 || current.startOdometerUrl || current.startMileage ? (
                  <Tag color="blue">有行程</Tag>
                ) : (
                  '-'
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
              {summary.tripCount > 1 ? (
                <>
                  <Descriptions.Item label="行程段数">
                    共 {summary.tripCount} 段
                  </Descriptions.Item>
                  <Descriptions.Item label="合计里程差（参考）">
                    {summary.totalKm != null ? `${summary.totalKm} km` : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="起止跨度（参考）" span={2}>
                    {summary.startMileage != null && summary.endMileage != null
                      ? `${summary.startMileage} → ${summary.endMileage} km`
                      : '-'}
                  </Descriptions.Item>
                </>
              ) : (
                <>
                  <Descriptions.Item label="里程差（参考）">
                    {summary.totalKm != null ? `${summary.totalKm} km` : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="开始里程">
                    {summary.startMileage != null ? `${summary.startMileage} km` : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="结束里程">
                    {summary.endMileage != null ? `${summary.endMileage} km` : '-'}
                  </Descriptions.Item>
                </>
              )}
            </Descriptions>
            {current.note ? (
              <p style={{ color: '#61756b' }}>备注：{current.note}</p>
            ) : null}
            {current.reviewNote ? (
              <p style={{ color: '#61756b' }}>审核说明：{current.reviewNote}</p>
            ) : null}
            {Array.isArray(current.lineItems) && current.lineItems.length > 0 ? (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px' }}>费用明细</h4>
                {current.lineItems.map((line, idx) => (
                  <div
                    key={line.id || idx}
                    style={{
                      marginBottom: 12,
                      padding: 12,
                      background: '#f7faf8',
                      borderRadius: 8,
                    }}
                  >
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {idx + 1}. {line.content || line.type || '明细'}
                      {line.expenseDate ? ` · ${line.expenseDate}` : ''}
                      {` · ¥${Number(line.amount || 0).toFixed(2)}`}
                    </p>
                    {line.note ? (
                      <p style={{ margin: '6px 0 0', color: '#61756b' }}>备注：{line.note}</p>
                    ) : null}
                    {line.type === 'trip' ? (
                      <>
                        <p style={{ margin: '6px 0 0', color: '#61756b' }}>
                          里程 {line.startMileage ?? '-'} → {line.endMileage ?? '-'}
                          {line.mileageKm != null ? `（差 ${line.mileageKm} km）` : ''}
                        </p>
                        <PhotoBlock
                          label="开始里程表"
                          urls={line.startOdometerUrl ? [line.startOdometerUrl] : []}
                        />
                        <PhotoBlock
                          label="开始导航"
                          urls={(line.startNavShots || []).map((s) => s.url)}
                        />
                        {(line.startNavShots || []).some((s) => s.remark) ? (
                          <p style={{ margin: '4px 0', color: '#61756b', fontSize: 12 }}>
                            开始导航备注：
                            {(line.startNavShots || [])
                              .map((s, i) => (s.remark ? `图${i + 1} ${s.remark}` : null))
                              .filter(Boolean)
                              .join('；')}
                          </p>
                        ) : null}
                        <PhotoBlock
                          label="结束导航"
                          urls={(line.endNavShots || []).map((s) => s.url)}
                        />
                        {(line.endNavShots || []).some((s) => s.remark) ? (
                          <p style={{ margin: '4px 0', color: '#61756b', fontSize: 12 }}>
                            结束导航备注：
                            {(line.endNavShots || [])
                              .map((s, i) => (s.remark ? `图${i + 1} ${s.remark}` : null))
                              .filter(Boolean)
                              .join('；')}
                          </p>
                        ) : null}
                        <PhotoBlock
                          label="结束里程表"
                          urls={line.endOdometerUrl ? [line.endOdometerUrl] : []}
                        />
                        <PhotoBlock label="费用凭证" urls={line.voucherUrls || []} />
                      </>
                    ) : (
                      <PhotoBlock label="照片" urls={line.photoUrls || []} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <>
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
              </>
            )}
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
          );
        })()}
      </Modal>
    </div>
  );
}
