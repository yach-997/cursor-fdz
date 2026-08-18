import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Timeline,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import {
  fetchRecordCaseGroups,
  fetchRecordsByCase,
  fetchRecord,
  approveRecord,
  rejectRecord,
  setRecordManualResult,
  analyzeAi,
  type RecordCaseGroup,
  type RecordItem,
  type RecordEntry,
  type AuditTrailEvent,
  resolveEntryKind,
} from '../../api/record';
import { formatDateTime } from '../../utils/displayLabels';
import EntryReviewCard from '../../components/EntryReviewCard';

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  submitted: { color: 'processing', text: '待审核' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已驳回' },
};

const CASE_STATUS_LABEL: Record<string, string> = {
  pending_assign: '待派单',
  assigned: '已派单',
  working: '作业中',
  finished: '已完工',
  settle_review: '待结算审核',
  settled: '已结算',
  month_locked: '已月结',
};

const TRAIL_LABEL: Record<string, string> = {
  submitted: '提交',
  resubmitted: '重新提交',
  auto_approved: 'AI 合格自动通过',
  approved: '管理员通过',
  rejected: '管理员驳回',
  reopened: '返工打开',
  manual_result: '人工确认检查项',
};

function unitTitle(row: RecordItem) {
  if (row.workUnit) {
    const label = row.unitLabel || '台';
    return `${label} #${row.workUnit.seq}`;
  }
  return row.task?.taskName || '-';
}

/** 验图审核：按案例聚合 → 待审单元 → 单条通过/驳回 */
export default function AuditPage() {
  const navigate = useNavigate();
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
  const [retryingEntryId, setRetryingEntryId] = useState<string>();
  const [manualBusyKey, setManualBusyKey] = useState<string>();

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

  const applyFreshDetail = (fresh: RecordItem) => {
    setDetail(fresh);
    setUnits((rows) => rows.map((row) => (row.id === fresh.id ? fresh : row)));
  };

  const handleManualConfirm = (entry: RecordEntry, result: 'pass' | 'fail') => {
    if (!detail) return;
    const label = result === 'pass' ? '合格' : '不合格';
    const busyKey = `${entry.templateEntryId}:${result}`;
    Modal.confirm({
      title: `确认设为${label}`,
      content: `将该检查项最终结论设为「${label}」？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setManualBusyKey(busyKey);
        try {
          const fresh = await setRecordManualResult(
            detail.id,
            entry.templateEntryId,
            result,
          );
          applyFreshDetail(fresh);
          message.success(`已人工确认${label}`);
        } catch (error: any) {
          message.error(error?.message || '确认失败');
          throw error;
        } finally {
          setManualBusyKey(undefined);
        }
      },
    });
  };

  const retryAnalysis = async (entry: RecordEntry) => {
    if (!detail || !entry.photos?.length) {
      message.warning('该检查项没有现场照片，无法重新分析');
      return;
    }
    const template = detail.task?.templateSnapshot?.find(
      (item) => item.id === entry.templateEntryId,
    );
    if (resolveEntryKind(template || {}) === 'record') {
      message.info('记录类条目不需要 AI 分析');
      return;
    }
    setRetryingEntryId(entry.templateEntryId);
    message.info('已开始重新分析');
    try {
      await analyzeAi({
        recordId: detail.id,
        templateEntryId: entry.templateEntryId,
        photoUrls: entry.photos,
        samplePhotoUrls: template?.samplePhotos || [],
      });
      const fresh = await fetchRecord(detail.id);
      applyFreshDetail(fresh);
      message.success('重新分析已完成');
    } catch (error: any) {
      message.error(error?.message || '重新分析失败');
      try {
        const fresh = await fetchRecord(detail.id);
        applyFreshDetail(fresh);
      } catch {
        // ignore
      }
    } finally {
      setRetryingEntryId(undefined);
    }
  };

  const groupColumns: ColumnsType<RecordCaseGroup> = [
    {
      title: '案例号',
      width: 160,
      render: (_, row) => row.gspCaseNo || '独立任务',
    },
    {
      title: '项目',
      ellipsis: true,
      render: (_, row) => row.projectName || '-',
    },
    {
      title: '案例状态',
      width: 120,
      render: (_, row) => {
        if (!row.serviceCaseId) return <Tag>任务</Tag>;
        const text = CASE_STATUS_LABEL[String(row.caseStatus || '')] || row.caseStatus || '-';
        return <Tag>{text}</Tag>;
      },
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
      title: '进度',
      width: 110,
      render: (_, row) =>
        row.plannedUnits != null
          ? `${row.completedUnits ?? 0}/${row.plannedUnits}`
          : '-',
    },
    {
      title: '最近提交',
      width: 180,
      render: (_, row) =>
        row.latestSubmittedAt ? formatDateTime(row.latestSubmittedAt) : '-',
    },
    {
      title: '操作',
      width: 180,
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" onClick={() => void openGroup(row)}>
            查看单元
          </Button>
          {row.gspCaseNo ? (
            <Button
              type="link"
              onClick={() =>
                navigate(`/finance/cases?keyword=${encodeURIComponent(row.gspCaseNo!)}`)
              }
            >
              案例
            </Button>
          ) : null}
        </Space>
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
      render: (v?: string) => formatDateTime(v),
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
              {ev.at ? formatDateTime(ev.at) : ''}
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
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="验图审核与费用结算相互独立"
        description="本页只审现场照片和 AI 结果，不改金额。网格长可审本网格；结算审核仅管理员。案例号与项目名来自案例主数据；可点「案例」跳转案例管理。AI 全部合格的报告已自动通过，不会出现在待审列表。"
      />
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
                ? ` · 提交于 ${formatDateTime(detail.submittedAt)}`
                : ''}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>操作追溯</div>
            {(detail.auditTrail || []).length ? (
              <Timeline items={trailItems(detail.auditTrail)} style={{ marginBottom: 20 }} />
            ) : (
              <div style={{ color: '#999', marginBottom: 20 }}>暂无追溯记录</div>
            )}

            {detail.entries?.map((entry) => {
              const tpl = detail.task?.templateSnapshot?.find(
                (item) => item.id === entry.templateEntryId,
              );
              const isRecord = resolveEntryKind(tpl || {}) === 'record';
              return (
              <EntryReviewCard
                key={entry.templateEntryId}
                title={tplName(entry.templateEntryId)}
                entry={entry}
                needRedo={detail.rejectReason?.entryIds?.includes(entry.templateEntryId)}
                showAi={!isRecord}
                canConfirm={['submitted', 'approved', 'rejected'].includes(detail.status)}
                manualBusy={
                  manualBusyKey === `${entry.templateEntryId}:pass`
                    ? 'pass'
                    : manualBusyKey === `${entry.templateEntryId}:fail`
                      ? 'fail'
                      : null
                }
                retrying={retryingEntryId === entry.templateEntryId}
                onConfirm={(result) => handleManualConfirm(entry, result)}
                onRetry={() => void retryAnalysis(entry)}
              />
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
