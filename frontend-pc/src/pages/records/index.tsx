import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  DatePicker,
  Drawer,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  fetchRecordCaseGroups,
  fetchRecordsByCase,
  fetchRecord,
  analyzeAi,
  compareRecords,
  type RecordCaseGroup,
  type RecordItem,
  type RecordEntry,
  type AuditTrailEvent,
} from '../../api/record';
import { fetchSites, fetchSiteMembers } from '../../api/site';
import { fetchDevices } from '../../api/device';
import { fetchInspectorPool } from '../../api/user';
import { downloadRecordsExport } from '../../api/stats';
import type { SiteItem, DeviceItem } from '../../types';
import { displayPhotoUrl } from '../../utils/photo-url';
import { CHECK_RESULT_LABEL } from '../../utils/displayLabels';

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  submitted: { color: 'processing', text: '待审核' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已驳回' },
  archived: { color: 'default', text: '已归档' },
};

const TRAIL_LABEL: Record<string, string> = {
  submitted: '提交',
  resubmitted: '重新提交',
  auto_approved: 'AI 合格自动通过',
  approved: '管理员通过',
  rejected: '管理员驳回',
  reopened: '返工打开',
};

function trailColor(action: string) {
  if (action === 'rejected') return 'red';
  if (action === 'approved' || action === 'auto_approved') return 'green';
  if (action === 'resubmitted' || action === 'reopened') return 'orange';
  return 'blue';
}

function unitTitle(row: RecordItem) {
  if (row.workUnit) {
    const label = row.unitLabel || '台';
    return `${label} #${row.workUnit.seq}`;
  }
  return row.task?.taskName || '-';
}

function finalResultView(entry: RecordEntry) {
  const manual =
    entry.manualResult === 'pass' || entry.manualResult === 'fail' ? entry.manualResult : null;
  if (entry.finalResult === 'pass') {
    return {
      label: manual === 'pass' ? '合格（工程师确认）' : '合格',
      color: 'success' as const,
    };
  }
  if (entry.finalResult === 'fail') {
    return {
      label: manual === 'fail' ? '不合格（工程师确认）' : '不合格',
      color: 'error' as const,
    };
  }
  if (entry.aiResult?.status === 'error') {
    return { label: '待人工判断', color: 'warning' as const };
  }
  return { label: '分析中', color: 'processing' as const };
}

function aiResultColor(status?: string) {
  if (status === 'pass') return 'success';
  if (status === 'fail') return 'error';
  if (status === 'error') return 'warning';
  return 'processing';
}

function withEntryAnalyzing(record: RecordItem, templateEntryId: string): RecordItem {
  const entries = record.entries.map((entry) =>
    entry.templateEntryId === templateEntryId
      ? {
          ...entry,
          aiResult: { status: 'pending', confidence: 0, reason: '重新分析中…' },
          finalResult: null,
        }
      : entry,
  );
  const aiSummary = entries.reduce(
    (summary, entry) => {
      const status = entry.aiResult?.status || 'pending';
      if (status === 'pass') summary.pass += 1;
      else if (status === 'fail') summary.fail += 1;
      else if (status === 'error') summary.error += 1;
      else summary.pending += 1;
      return summary;
    },
    { pass: 0, fail: 0, pending: 0, error: 0 },
  );
  return { ...record, entries, aiSummary };
}

/** 历史查询：按案例聚合 → 全部单元报告 → 详情 */
export default function RecordsPage() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<RecordCaseGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [siteId, setSiteId] = useState<string | undefined>(
    searchParams.get('siteId') || undefined,
  );
  const [deviceId, setDeviceId] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [region, setRegion] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [inspectorId, setInspectorId] = useState<string>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [inspectors, setInspectors] = useState<Array<{ value: string; label: string }>>([]);

  const [unitsOpen, setUnitsOpen] = useState(false);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [activeGroup, setActiveGroup] = useState<RecordCaseGroup | null>(null);
  const [units, setUnits] = useState<RecordItem[]>([]);

  const [detail, setDetail] = useState<RecordItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [retryingEntryId, setRetryingEntryId] = useState<string>();

  const [compareOpen, setCompareOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<RecordItem[]>([]);

  useEffect(() => {
    fetchSites({ limit: 100, status: 'active' }).then((res) => setSites(res.list));
  }, []);

  useEffect(() => {
    if (siteId) {
      fetchDevices({ siteId, limit: 100 }).then((res) => setDevices(res.list));
      fetchSiteMembers(siteId, 'inspector').then((members) => {
        setInspectors(
          members
            .filter((m) => m.user)
            .map((m) => ({
              value: m.userId,
              label: m.user!.realName,
            })),
        );
      });
    } else {
      setDevices([]);
      setDeviceId(undefined);
      fetchInspectorPool({ limit: 100 })
        .then((result) => {
          setInspectors(result.list.map((user) => ({ value: user.id, label: user.realName })));
        })
        .catch(() => {
          setInspectors([]);
        });
    }
  }, [siteId]);

  const filterParams = useCallback(() => {
    const params: Record<string, unknown> = { scope: 'history' };
    if (siteId) params.siteId = siteId;
    if (deviceId) params.deviceId = deviceId;
    if (status) params.status = status;
    if (keyword.trim()) params.keyword = keyword.trim();
    if (region.trim()) params.region = region.trim();
    if (serialNumber.trim()) params.serialNumber = serialNumber.trim();
    if (inspectorId) params.inspectorId = inspectorId;
    if (dateRange?.[0]) params.startDate = dateRange[0].format('YYYY-MM-DD');
    if (dateRange?.[1]) params.endDate = dateRange[1].format('YYYY-MM-DD');
    return params;
  }, [
    siteId,
    deviceId,
    status,
    keyword,
    region,
    serialNumber,
    inspectorId,
    dateRange,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchRecordCaseGroups({
        ...filterParams(),
        page,
        limit: 10,
      });
      setGroups(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, filterParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const openGroup = async (group: RecordCaseGroup) => {
    setActiveGroup(group);
    setUnitsOpen(true);
    setUnitsLoading(true);
    setSelectedRowKeys([]);
    try {
      const res = await fetchRecordsByCase(group.groupKey, {
        ...filterParams(),
        limit: 100,
      });
      setUnits(res.list);
    } finally {
      setUnitsLoading(false);
    }
  };

  const openDetail = async (id: string) => {
    const rec = await fetchRecord(id);
    setDetail(rec);
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (!drawerOpen || !detail?.aiSummary?.pending) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const fresh = await fetchRecord(detail.id);
        if (disposed) return;
        setDetail(fresh);
        setUnits((rows) => rows.map((row) => (row.id === fresh.id ? fresh : row)));
      } catch {
        // ignore transient errors
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [drawerOpen, detail?.id, detail?.aiSummary?.pending]);

  const retryAnalysis = async (entry: RecordEntry) => {
    if (!detail || !entry.photos?.length) {
      message.warning('该检查项没有现场照片，无法重新分析');
      return;
    }
    setRetryingEntryId(entry.templateEntryId);
    const analyzing = withEntryAnalyzing(detail, entry.templateEntryId);
    setDetail(analyzing);
    setUnits((rows) => rows.map((row) => (row.id === analyzing.id ? analyzing : row)));
    message.info('已开始重新分析，结果会自动刷新');
    try {
      const template = detail.task?.templateSnapshot?.find(
        (item) => item.id === entry.templateEntryId,
      );
      await analyzeAi({
        recordId: detail.id,
        templateEntryId: entry.templateEntryId,
        photoUrls: entry.photos,
        samplePhotoUrls: template?.samplePhotos || [],
      });
      const fresh = await fetchRecord(detail.id);
      setDetail(fresh);
      setUnits((rows) => rows.map((row) => (row.id === fresh.id ? fresh : row)));
      message.success('重新分析已完成');
    } catch {
      try {
        const fresh = await fetchRecord(detail.id);
        setDetail(fresh);
        setUnits((rows) => rows.map((row) => (row.id === fresh.id ? fresh : row)));
        const current = fresh.entries.find(
          (item) => item.templateEntryId === entry.templateEntryId,
        );
        if (current?.aiResult?.status === 'pending') {
          message.warning('请求等待超时，后台仍在分析，页面会继续自动刷新');
        } else if (current?.aiResult?.status !== entry.aiResult?.status) {
          message.success('重新分析已完成');
        } else {
          message.error('重新分析未能启动，请稍后重试');
        }
      } catch {
        message.warning('网络暂时不可用，页面恢复连接后会继续查询分析结果');
      }
    } finally {
      setRetryingEntryId(undefined);
    }
  };

  const handleExport = async () => {
    try {
      await downloadRecordsExport({
        siteId,
        status: status || undefined,
        startDate: dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: dateRange?.[1]?.format('YYYY-MM-DD'),
      });
      message.success('导出已开始');
    } catch {
      message.error('导出失败');
    }
  };

  const handleCompare = async () => {
    const first = units.find((u) => u.id === selectedRowKeys[0]);
    const compareDeviceId = first?.task?.deviceId;
    if (!compareDeviceId || selectedRowKeys.length < 2) {
      message.warning('请勾选同一案例下至少 2 条报告进行对比');
      return;
    }
    const result = await compareRecords(compareDeviceId, selectedRowKeys);
    setCompareResult(result.list);
    setCompareOpen(true);
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
      title: '报告数',
      width: 90,
      render: (_, row) => row.recordCount,
    },
    {
      title: '状态汇总',
      width: 220,
      render: (_, row) => (
        <Space size={[4, 4]} wrap>
          {row.pendingCount > 0 ? <Tag color="processing">待审 {row.pendingCount}</Tag> : null}
          {row.approvedCount > 0 ? <Tag color="success">通过 {row.approvedCount}</Tag> : null}
          {row.rejectedCount > 0 ? <Tag color="error">驳回 {row.rejectedCount}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '最近提交',
      width: 170,
      render: (_, row) =>
        row.latestSubmittedAt ? new Date(row.latestSubmittedAt).toLocaleString() : '-',
    },
    {
      title: '操作',
      width: 110,
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
      title: 'AI 结果',
      width: 140,
      render: (_, row) => {
        const a = row.aiSummary;
        if (!a) return '-';
        if (a.fail > 0) return <Tag color="error">不合格 {a.fail}</Tag>;
        if (a.pending > 0) return <Tag color="processing">分析中 {a.pending}</Tag>;
        if (a.error > 0) return <Tag color="warning">待人工判断 {a.error}</Tag>;
        return <Tag color="success">合格 {a.pass}</Tag>;
      },
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
      width: 90,
      render: (_, row) => (
        <Button type="link" onClick={() => void openDetail(row.id)}>
          详情
        </Button>
      ),
    },
  ];

  const tplName = (rec: RecordItem, templateEntryId: string) =>
    rec.task?.templateSnapshot?.find((e) => e.id === templateEntryId)?.name ||
    templateEntryId.slice(0, 8);

  const trailItems = (events?: AuditTrailEvent[]) =>
    (events || [])
      .slice()
      .reverse()
      .map((ev, idx) => ({
        key: `${ev.at}-${idx}`,
        color: trailColor(ev.action),
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
        按案例汇总已提交报告。点进案例可查看全部单元（含通过/驳回/待审）；审核仍在「报告审核」按单条处理。
      </p>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          placeholder="案例号/项目/任务"
          style={{ width: 160 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => {
            setPage(1);
            void load();
          }}
        />
        <Input
          allowClear
          placeholder="区域（省/市/现场）"
          style={{ width: 160 }}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          onPressEnter={() => {
            setPage(1);
            void load();
          }}
        />
        <Input
          allowClear
          placeholder="设备序列号"
          style={{ width: 150 }}
          value={serialNumber}
          onChange={(e) => setSerialNumber(e.target.value)}
          onPressEnter={() => {
            setPage(1);
            void load();
          }}
        />
        <Select
          allowClear
          placeholder="网格"
          style={{ width: 160 }}
          value={siteId}
          onChange={setSiteId}
          options={sites.map((s) => ({ label: s.name, value: s.id }))}
        />
        <Select
          allowClear
          placeholder="设备"
          style={{ width: 150 }}
          value={deviceId}
          onChange={setDeviceId}
          disabled={!siteId}
          options={devices.map((d) => ({
            label: d.serialNumber,
            value: d.id,
          }))}
        />
        <Select
          allowClear
          placeholder="工程师"
          style={{ width: 120 }}
          value={inspectorId}
          onChange={setInspectorId}
          options={inspectors}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          value={status}
          onChange={setStatus}
          options={[
            { label: '待审核', value: 'submitted' },
            { label: '已通过', value: 'approved' },
            { label: '已驳回', value: 'rejected' },
            { label: '已归档', value: 'archived' },
          ]}
        />
        <DatePicker.RangePicker
          value={dateRange}
          onChange={(v) => {
            setPage(1);
            setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null);
          }}
        />
        <Button
          type="primary"
          onClick={() => {
            setPage(1);
            void load();
          }}
        >
          查询
        </Button>
        <Button onClick={() => void handleExport()}>导出表格</Button>
      </Space>

      <Table
        rowKey="groupKey"
        loading={loading}
        columns={groupColumns}
        dataSource={groups}
        scroll={{ x: 'max-content' }}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
      />

      <Drawer
        title={
          activeGroup
            ? `${activeGroup.gspCaseNo || '独立任务'} · ${activeGroup.projectName || ''}`
            : '案例报告'
        }
        width={920}
        open={unitsOpen}
        onClose={() => {
          setUnitsOpen(false);
          setActiveGroup(null);
          setSelectedRowKeys([]);
        }}
      >
        <Table
          rowKey="id"
          loading={unitsLoading}
          columns={unitColumns}
          dataSource={units}
          pagination={false}
          scroll={{ x: 'max-content' }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
          }}
          footer={
            selectedRowKeys.length >= 2
              ? () => (
                  <Button type="primary" onClick={() => void handleCompare()}>
                    对比已选 {selectedRowKeys.length} 条报告
                  </Button>
                )
              : undefined
          }
        />
      </Drawer>

      <Drawer
        title={
          detail
            ? `${detail.gspCaseNo ? `${detail.gspCaseNo} · ` : ''}${unitTitle(detail)}`
            : '记录详情'
        }
        width={760}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {detail ? (
          <>
            <div style={{ marginBottom: 12, color: '#666' }}>
              工程师：{detail.inspectorName || '-'}
              {detail.submittedAt
                ? ` · 提交于 ${new Date(detail.submittedAt).toLocaleString()}`
                : ''}
            </div>
            <div style={{ marginBottom: 20 }}>
              <Tag color={STATUS_MAP[detail.status]?.color}>
                {STATUS_MAP[detail.status]?.text || '未知状态'}
              </Tag>
              {detail.aiSummary ? (
                <Tag style={{ marginLeft: 8 }}>
                  AI 合格 {detail.aiSummary.pass} / 不合格 {detail.aiSummary.fail} / 异常{' '}
                  {detail.aiSummary.error ?? 0} / 分析中 {detail.aiSummary.pending}
                </Tag>
              ) : null}
            </div>

            {detail.location ? (
              <div
                style={{
                  marginBottom: 24,
                  padding: '12px 14px',
                  background:
                    detail.location.status === 'failed' ||
                    detail.location.status === 'skipped'
                      ? '#fff2f0'
                      : detail.location.status === 'weak'
                        ? '#fffbe6'
                        : '#f6ffed',
                  border: `1px solid ${
                    detail.location.status === 'failed' ||
                    detail.location.status === 'skipped'
                      ? '#ffccc7'
                      : detail.location.status === 'weak'
                        ? '#ffe58f'
                        : '#b7eb8f'
                  }`,
                  borderRadius: 8,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  现场定位
                  {detail.location.status === 'failed' ||
                  detail.location.status === 'skipped' ? (
                    <Tag color="error" style={{ marginLeft: 8 }}>
                      位置异常
                    </Tag>
                  ) : detail.location.status === 'weak' ? (
                    <Tag color="warning" style={{ marginLeft: 8 }}>
                      弱定位
                    </Tag>
                  ) : detail.location.latitude != null ? (
                    <Tag color="success" style={{ marginLeft: 8 }}>
                      正常
                    </Tag>
                  ) : null}
                </div>
                {detail.location.latitude != null && detail.location.longitude != null ? (
                  <div>
                    经纬度：{Number(detail.location.latitude).toFixed(6)},{' '}
                    {Number(detail.location.longitude).toFixed(6)}
                  </div>
                ) : (
                  <div style={{ color: '#a8071a' }}>
                    {detail.location.reason ||
                      (detail.location.status === 'skipped'
                        ? '工程师确认无法定位后继续作业'
                        : '未能获取现场定位')}
                  </div>
                )}
                {detail.location.address ? (
                  <div style={{ marginTop: 4 }}>地址：{detail.location.address}</div>
                ) : null}
                <div style={{ marginTop: 4, color: '#666', fontSize: 12 }}>
                  {detail.location.accuracyMeters != null && detail.location.accuracyMeters > 0
                    ? `精度约 ${detail.location.accuracyMeters} 米`
                    : ''}
                  {detail.location.distanceToSiteMeters != null
                    ? ` · 距归属网格约 ${detail.location.distanceToSiteMeters} 米`
                    : ''}
                  {detail.location.capturedAt
                    ? ` · ${new Date(detail.location.capturedAt).toLocaleString()}`
                    : ''}
                  {detail.location.reason &&
                  detail.location.latitude != null
                    ? ` · ${detail.location.reason}`
                    : ''}
                </div>
              </div>
            ) : null}

            <div style={{ fontWeight: 600, marginBottom: 12 }}>操作追溯</div>
            {(detail.auditTrail || []).length ? (
              <Timeline items={trailItems(detail.auditTrail)} style={{ marginBottom: 24 }} />
            ) : (
              <div style={{ color: '#999', marginBottom: 24 }}>暂无追溯记录（旧数据）</div>
            )}

            <div style={{ fontWeight: 600, marginBottom: 12 }}>检查项</div>
            {detail.entries?.map((entry) => (
              <div key={entry.templateEntryId} style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {tplName(detail, entry.templateEntryId)}
                </div>
                <Space style={{ marginBottom: 8 }}>
                  <Tag color={aiResultColor(entry.aiResult?.status)}>
                    智能分析：
                    {CHECK_RESULT_LABEL[entry.aiResult?.status || 'pending'] || '待人工判断'}（
                    {((entry.aiResult?.confidence || 0) * 100).toFixed(0)}%)
                  </Tag>
                  {(() => {
                    const final = finalResultView(entry);
                    return <Tag color={final.color}>最终结论：{final.label}</Tag>;
                  })()}
                  {entry.aiResult?.status &&
                  entry.finalResult &&
                  entry.aiResult.status !== entry.finalResult &&
                  ['pass', 'fail'].includes(entry.aiResult.status) ? (
                    <Tag color="orange">AI与最终结论不一致，以最终结论为准</Tag>
                  ) : null}
                  {detail.status === 'submitted' &&
                  ['error', 'fail'].includes(entry.aiResult?.status || '') ? (
                    <Button
                      size="small"
                      loading={retryingEntryId === entry.templateEntryId}
                      onClick={() => void retryAnalysis(entry)}
                    >
                      重新分析
                    </Button>
                  ) : null}
                </Space>
                {entry.aiResult?.reason ? (
                  <div style={{ color: '#888', marginBottom: 8 }}>{entry.aiResult.reason}</div>
                ) : null}
                <Image.PreviewGroup>
                  <Space wrap>
                    {(entry.photos || []).map((url) => (
                      <Image
                        key={url}
                        src={displayPhotoUrl(url)}
                        width={120}
                        height={120}
                        style={{ objectFit: 'cover', borderRadius: 8 }}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </div>
            ))}
          </>
        ) : null}
      </Drawer>

      <Modal
        title="横向对比"
        open={compareOpen}
        width={900}
        footer={null}
        onCancel={() => setCompareOpen(false)}
      >
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>
          {compareResult.map((rec) => (
            <div
              key={rec.id}
              style={{
                minWidth: 260,
                border: '1px solid #eee',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{unitTitle(rec)}</div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>
                {rec.submittedAt
                  ? new Date(rec.submittedAt).toLocaleDateString()
                  : rec.id.slice(0, 8)}
              </div>
              <Tag>{STATUS_MAP[rec.status]?.text || '未知状态'}</Tag>
              {rec.entries.map((entry) => (
                <div key={entry.templateEntryId} style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13 }}>{tplName(rec, entry.templateEntryId)}</div>
                  <Tag color={finalResultView(entry).color} style={{ marginTop: 4 }}>
                    {finalResultView(entry).label}
                  </Tag>
                  {(entry.photos || []).slice(0, 1).map((url) => (
                    <Image
                      key={url}
                      src={displayPhotoUrl(url)}
                      width={80}
                      height={80}
                      style={{ marginTop: 4 }}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
