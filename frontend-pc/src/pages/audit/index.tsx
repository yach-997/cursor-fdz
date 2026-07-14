import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Drawer,
  Image,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Timeline,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchRecords,
  fetchRecord,
  approveRecord,
  rejectRecord,
  type RecordItem,
  type AuditTrailEvent,
} from '../../api/record';

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  submitted: { color: 'processing', text: '待审核' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已驳回' },
};

const TRAIL_LABEL: Record<string, string> = {
  submitted: '提交',
  resubmitted: '重新提交',
  auto_approved: 'AI 合格自动通过',
  approved: '管理员通过',
  rejected: '管理员驳回',
  reopened: '返工打开',
};

/** 报告审核：只看待审的 AI 不合格报告 + 已驳回；通过历史追溯链 */
export default function AuditPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'pending' | 'rejected'>('pending');
  const [detail, setDetail] = useState<RecordItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectEntryIds, setRejectEntryIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res =
        tab === 'pending'
          ? await fetchRecords({ page, limit: 10, scope: 'audit' })
          : await fetchRecords({ page, limit: 10, status: 'rejected' });
      setData(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id: string) => {
    const rec = await fetchRecord(id);
    setDetail(rec);
    setDrawerOpen(true);
  };

  const handleApprove = async () => {
    if (!detail) return;
    await approveRecord(detail.id);
    message.success('已通过');
    setDrawerOpen(false);
    load();
  };

  const handleReject = async () => {
    if (!detail || !rejectReason.trim()) {
      message.warning('请填写驳回原因');
      return;
    }
    if (!rejectEntryIds.length) {
      message.warning('请勾选需返工的检查项');
      return;
    }
    await rejectRecord(detail.id, rejectReason.trim(), rejectEntryIds);
    message.success('已驳回，巡检员可见原因与检查项');
    setRejectOpen(false);
    setRejectReason('');
    setRejectEntryIds([]);
    setDrawerOpen(false);
    load();
  };

  const columns: ColumnsType<RecordItem> = [
    {
      title: '任务',
      render: (_, row) => row.task?.taskName || '-',
    },
    {
      title: '设备类型',
      dataIndex: 'deviceType',
      width: 140,
    },
    {
      title: 'AI 不合格',
      width: 110,
      render: (_, row) => (
        <Tag color="error">{row.aiSummary?.fail ?? '-'} 项</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => {
        const m = STATUS_MAP[s] || { color: 'default', text: s };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '提交时间',
      dataIndex: 'submittedAt',
      width: 180,
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: '操作',
      width: 120,
      render: (_, row) => (
        <Button type="link" onClick={() => openDetail(row.id)}>
          审核详情
        </Button>
      ),
    },
  ];

  const tplName = (templateEntryId: string) =>
    detail?.task?.templateSnapshot?.find((e) => e.id === templateEntryId)?.name ||
    templateEntryId.slice(0, 8);

  const trailItems = (events?: AuditTrailEvent[]) =>
    (events || [])
      .slice()
      .reverse()
      .map((ev, idx) => ({
        key: `${ev.at}-${idx}`,
        color:
          ev.action === 'rejected'
            ? 'red'
            : ev.action === 'approved' || ev.action === 'auto_approved'
              ? 'green'
              : 'blue',
        children: (
          <div>
            <div style={{ fontWeight: 600 }}>
              {TRAIL_LABEL[ev.action] || ev.action}
              {ev.byName ? ` · ${ev.byName}` : ''}
            </div>
            <div style={{ color: '#888', fontSize: 12 }}>
              {ev.at ? new Date(ev.at).toLocaleString() : ''}
            </div>
            {ev.summary ? <div style={{ marginTop: 4 }}>{ev.summary}</div> : null}
            {ev.reason ? (
              <div style={{ marginTop: 4, color: '#a8071a' }}>原因：{ev.reason}</div>
            ) : null}
          </div>
        ),
      }));

  return (
    <div>
      <p style={{ color: '#666', marginBottom: 12 }}>
        仅展示 AI 分析不合格、需人工处理的报告。AI 全部合格的会自动通过并进入「历史查询」。
      </p>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type={tab === 'pending' ? 'primary' : 'default'}
          onClick={() => {
            setTab('pending');
            setPage(1);
          }}
        >
          待审核（AI 不合格）
        </Button>
        <Button
          type={tab === 'rejected' ? 'primary' : 'default'}
          onClick={() => {
            setTab('rejected');
            setPage(1);
          }}
        >
          已驳回
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        pagination={{
          current: page,
          total,
          pageSize: 10,
          onChange: setPage,
        }}
      />

      <Drawer
        title={detail?.task?.taskName || '审核详情'}
        width={680}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          detail?.status === 'submitted' ? (
            <Space>
              <Button danger onClick={() => setRejectOpen(true)}>
                驳回
              </Button>
              <Button type="primary" onClick={() => void handleApprove()}>
                通过
              </Button>
            </Space>
          ) : null
        }
      >
        {detail ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>操作追溯</div>
            {(detail.auditTrail || []).length ? (
              <Timeline items={trailItems(detail.auditTrail)} style={{ marginBottom: 20 }} />
            ) : (
              <div style={{ color: '#999', marginBottom: 20 }}>暂无追溯记录</div>
            )}

            {detail.entries?.map((entry) => {
              const needRedo = detail.rejectReason?.entryIds?.includes(entry.templateEntryId);
              const fail =
                entry.aiResult?.status === 'fail' || entry.finalResult === 'fail';
              return (
                <div key={entry.templateEntryId} style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {tplName(entry.templateEntryId)}
                    {fail ? (
                      <Tag color="error" style={{ marginLeft: 8 }}>
                        AI 不合格
                      </Tag>
                    ) : null}
                    {needRedo ? (
                      <Tag color="error" style={{ marginLeft: 8 }}>
                        需返工
                      </Tag>
                    ) : null}
                  </div>
                  <div style={{ marginBottom: 8, color: '#666' }}>
                    AI：{entry.aiResult?.status}（
                    {((entry.aiResult?.confidence || 0) * 100).toFixed(0)}%）
                    {entry.aiResult?.reason ? ` · ${entry.aiResult.reason}` : ''}
                  </div>
                  <Image.PreviewGroup>
                    <Space wrap>
                      {(entry.photos || []).map((url) => (
                        <Image
                          key={url}
                          src={url}
                          width={96}
                          height={96}
                          style={{ objectFit: 'cover' }}
                        />
                      ))}
                    </Space>
                  </Image.PreviewGroup>
                </div>
              );
            })}
          </>
        ) : null}
      </Drawer>

      <Modal
        title="驳回报告"
        open={rejectOpen}
        onOk={() => void handleReject()}
        onCancel={() => {
          setRejectOpen(false);
          setRejectEntryIds([]);
        }}
        afterOpenChange={(open) => {
          if (open && detail) {
            const fails = detail.entries
              .filter(
                (e) => e.aiResult?.status === 'fail' || e.finalResult === 'fail',
              )
              .map((e) => e.templateEntryId);
            setRejectEntryIds(
              fails.length ? fails : detail.entries.map((e) => e.templateEntryId),
            );
          }
        }}
      >
        <div style={{ marginBottom: 12, fontWeight: 500 }}>勾选需返工的检查项</div>
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}
          value={rejectEntryIds}
          onChange={(v) => setRejectEntryIds(v as string[])}
        >
          {(detail?.entries || []).map((e) => (
            <Checkbox key={e.templateEntryId} value={e.templateEntryId}>
              {tplName(e.templateEntryId)}
              {e.aiResult?.status === 'fail' ? '（AI 不合格）' : ''}
            </Checkbox>
          ))}
        </Checkbox.Group>
        <Input.TextArea
          rows={4}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="请填写驳回原因（巡检员可见，并记入追溯链）"
        />
      </Modal>
    </div>
  );
}
