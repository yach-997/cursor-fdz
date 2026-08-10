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
  fetchRecordCaseGroups,
  fetchRecordsByCase,
  fetchRecord,
  approveRecord,
  rejectRecord,
  type RecordCaseGroup,
  type RecordItem,
  type AuditTrailEvent,
} from '../../api/record';
import { displayPhotoUrl } from '../../utils/photo-url';
import { CHECK_RESULT_LABEL } from '../../utils/displayLabels';

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

function unitTitle(row: RecordItem) {
  if (row.workUnit) {
    const label = row.unitLabel || '台';
    return `${label} #${row.workUnit.seq}`;
  }
  return row.task?.taskName || '-';
}

/** 报告审核：按案例聚合 → 待审单元 → 单条通过/驳回 */
export default function AuditPage() {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<RecordCaseGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'pending' | 'rejected'>('pending');

  const [unitsOpen, setUnitsOpen] = useState(false);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [activeGroup, setActiveGroup] = useState<RecordCaseGroup | null>(null);
  const [units, setUnits] = useState<RecordItem[]>([]);

  const [detail, setDetail] = useState<RecordItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectEntryIds, setRejectEntryIds] = useState<string[]>([]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res =
        tab === 'pending'
          ? await fetchRecordCaseGroups({ page, limit: 10, scope: 'audit' })
          : await fetchRecordCaseGroups({ page, limit: 10, status: 'rejected' });
      setGroups(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, tab]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const openGroup = async (group: RecordCaseGroup) => {
    setActiveGroup(group);
    setUnitsOpen(true);
    setUnitsLoading(true);
    try {
      const res =
        tab === 'pending'
          ? await fetchRecordsByCase(group.groupKey, { scope: 'audit', limit: 100 })
          : await fetchRecordsByCase(group.groupKey, {
              status: 'rejected',
              limit: 100,
            });
      setUnits(res.list);
    } finally {
      setUnitsLoading(false);
    }
  };

  const reloadUnits = async () => {
    if (!activeGroup) return;
    setUnitsLoading(true);
    try {
      const res =
        tab === 'pending'
          ? await fetchRecordsByCase(activeGroup.groupKey, {
              scope: 'audit',
              limit: 100,
            })
          : await fetchRecordsByCase(activeGroup.groupKey, {
              status: 'rejected',
              limit: 100,
            });
      setUnits(res.list);
      if (!res.list.length) {
        setUnitsOpen(false);
        setActiveGroup(null);
      }
    } finally {
      setUnitsLoading(false);
    }
  };

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
    await reloadUnits();
    void loadGroups();
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
    message.success('已驳回，工程师可见原因与检查项');
    setRejectOpen(false);
    setRejectReason('');
    setRejectEntryIds([]);
    setDrawerOpen(false);
    await reloadUnits();
    void loadGroups();
  };

  const groupColumns: ColumnsType<RecordCaseGroup> = [
    {
      title: '案例号',
      width: 160,
      render: (_, row) => row.gspCaseNo || '独立任务',
    },
    {
      title: '项目',
      render: (_, row) => row.projectName || '-',
    },
    {
      title: tab === 'pending' ? '待审报告' : '驳回报告',
      width: 110,
      render: (_, row) =>
        tab === 'pending' ? (
          <Tag color="processing">{row.pendingCount || row.recordCount}</Tag>
        ) : (
          <Tag color="error">{row.rejectedCount || row.recordCount}</Tag>
        ),
    },
    {
      title: '最近提交',
      width: 180,
      render: (_, row) =>
        row.latestSubmittedAt ? new Date(row.latestSubmittedAt).toLocaleString() : '-',
    },
    {
      title: '操作',
      width: 120,
      render: (_, row) => (
        <Button type="link" onClick={() => void openGroup(row)}>
          查看单元
        </Button>
      ),
    },
  ];

  const unitColumns: ColumnsType<RecordItem> = [
    {
      title: '单元',
      render: (_, row) => unitTitle(row),
    },
    {
      title: '工程师',
      width: 110,
      render: (_, row) => row.inspectorName || '-',
    },
    {
      title: '审核类型',
      width: 220,
      render: (_, row) =>
        row.task?.aiEnabled === false ? (
          <Tag color="orange">未启用 AI（人工审核）</Tag>
        ) : (
          <Space size={[4, 4]} wrap>
            {(row.aiSummary?.fail || 0) > 0 ? (
              <Tag color="error">AI 不合格 {row.aiSummary?.fail} 项</Tag>
            ) : null}
            {(row.aiSummary?.error || 0) > 0 ? (
              <Tag color="warning">AI 异常 {row.aiSummary?.error} 项</Tag>
            ) : null}
          </Space>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => {
        const m = STATUS_MAP[s] || { color: 'default', text: '未知状态' };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '提交时间',
      dataIndex: 'submittedAt',
      width: 170,
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: '操作',
      width: 110,
      render: (_, row) => (
        <Button type="link" onClick={() => void openDetail(row.id)}>
          {tab === 'pending' ? '审核' : '详情'}
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
              {TRAIL_LABEL[ev.action] || '其他操作'}
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
        按案例汇总待审报告。点进案例后按单元逐条通过/驳回；AI 全部合格的已自动通过，不会出现在此列表。
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
        rowKey="groupKey"
        loading={loading}
        columns={groupColumns}
        dataSource={groups}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          total,
          pageSize: 10,
          onChange: setPage,
        }}
      />

      <Drawer
        title={
          activeGroup
            ? `${activeGroup.gspCaseNo || '独立任务'} · ${activeGroup.projectName || ''}`
            : '案例单元'
        }
        width={860}
        open={unitsOpen}
        onClose={() => {
          setUnitsOpen(false);
          setActiveGroup(null);
        }}
      >
        <Table
          rowKey="id"
          loading={unitsLoading}
          columns={unitColumns}
          dataSource={units}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: tab === 'pending' ? '暂无待审单元' : '暂无驳回报告' }}
        />
      </Drawer>

      <Drawer
        title={
          detail
            ? `${detail.gspCaseNo ? `${detail.gspCaseNo} · ` : ''}${unitTitle(detail)}`
            : '审核详情'
        }
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
            <div style={{ marginBottom: 12, color: '#666' }}>
              工程师：{detail.inspectorName || '-'}
              {detail.submittedAt
                ? ` · 提交于 ${new Date(detail.submittedAt).toLocaleString()}`
                : ''}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>操作追溯</div>
            {(detail.auditTrail || []).length ? (
              <Timeline items={trailItems(detail.auditTrail)} style={{ marginBottom: 20 }} />
            ) : (
              <div style={{ color: '#999', marginBottom: 20 }}>暂无追溯记录</div>
            )}

            {detail.entries?.map((entry) => {
              const needRedo = detail.rejectReason?.entryIds?.includes(entry.templateEntryId);
              const aiFail = entry.aiResult?.status === 'fail';
              const aiError = entry.aiResult?.status === 'error';
              const manualResult = entry.manualResult;
              return (
                <div key={entry.templateEntryId} style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {tplName(entry.templateEntryId)}
                    {aiFail ? (
                      <Tag color="error" style={{ marginLeft: 8 }}>
                        AI 不合格
                      </Tag>
                    ) : null}
                    {aiError ? (
                      <Tag color="warning" style={{ marginLeft: 8 }}>
                        AI 异常
                      </Tag>
                    ) : null}
                    {manualResult === 'pass' || manualResult === 'fail' ? (
                      <Tag
                        color={manualResult === 'fail' ? 'error' : 'success'}
                        style={{ marginLeft: 8 }}
                      >
                        工程师现场确认{manualResult === 'fail' ? '不合格' : '合格'}
                      </Tag>
                    ) : (
                      <Tag style={{ marginLeft: 8 }}>工程师未确认</Tag>
                    )}
                    {needRedo ? (
                      <Tag color="error" style={{ marginLeft: 8 }}>
                        需返工
                      </Tag>
                    ) : null}
                  </div>
                  <div style={{ marginBottom: 8, color: '#666' }}>
                    智能分析：
                    {CHECK_RESULT_LABEL[entry.aiResult?.status || 'pending'] || '待人工判断'}（
                    {((entry.aiResult?.confidence || 0) * 100).toFixed(0)}%）
                    {entry.aiResult?.reason ? ` · ${entry.aiResult.reason}` : ''}
                  </div>
                  <div style={{ marginBottom: 8, color: '#666' }}>
                    现场结论：
                    {manualResult === 'pass'
                      ? '工程师确认合格'
                      : manualResult === 'fail'
                        ? '工程师确认不合格'
                        : '工程师未选择，以管理员审核为准'}
                  </div>
                  <Image.PreviewGroup>
                    <Space wrap>
                      {(entry.photos || []).map((url) => (
                        <Image
                          key={url}
                          src={displayPhotoUrl(url)}
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
          placeholder="请填写驳回原因（工程师可见，并记入追溯链）"
        />
      </Modal>
    </div>
  );
}
