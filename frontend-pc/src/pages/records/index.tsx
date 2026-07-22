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
  fetchRecords,
  fetchRecord,
  compareRecords,
  type RecordItem,
  type AuditTrailEvent,
} from '../../api/record';
import { fetchSites, fetchSiteMembers } from '../../api/site';
import { fetchDevices } from '../../api/device';
import { fetchInspectorPool } from '../../api/user';
import { downloadRecordsExport } from '../../api/stats';
import type { SiteItem, DeviceItem } from '../../types';
import { DEVICE_TYPE_LABEL } from '../../types';
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

/** 历史查询：所有已提交报告（AI 合格/不合格）+ 操作追溯 */
export default function RecordsPage() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RecordItem[]>([]);
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

  const [detail, setDetail] = useState<RecordItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareDeviceId, setCompareDeviceId] = useState<string>();
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
      fetchInspectorPool({ limit: 100 }).then((result) => {
        setInspectors(result.list.map((user) => ({ value: user.id, label: user.realName })));
      });
    }
  }, [siteId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 10, scope: 'history' };
      if (siteId) params.siteId = siteId;
      if (deviceId) params.deviceId = deviceId;
      if (status) params.status = status;
      if (keyword.trim()) params.keyword = keyword.trim();
      if (region.trim()) params.region = region.trim();
      if (serialNumber.trim()) params.serialNumber = serialNumber.trim();
      if (inspectorId) params.inspectorId = inspectorId;
      if (dateRange?.[0]) params.startDate = dateRange[0].format('YYYY-MM-DD');
      if (dateRange?.[1]) params.endDate = dateRange[1].format('YYYY-MM-DD');
      const res = await fetchRecords(params);
      setData(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    siteId,
    deviceId,
    status,
    keyword,
    region,
    serialNumber,
    inspectorId,
    dateRange,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id: string) => {
    const rec = await fetchRecord(id);
    setDetail(rec);
    setDrawerOpen(true);
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
    if (!compareDeviceId || selectedRowKeys.length < 2) {
      message.warning('请选择同一设备下的至少 2 条记录');
      return;
    }
    const result = await compareRecords(compareDeviceId, selectedRowKeys);
    setCompareResult(result.list);
    setCompareOpen(true);
  };

  const columns: ColumnsType<RecordItem> = [
    {
      title: '任务',
      render: (_, row) => row.task?.taskName || '-',
    },
    {
      title: '设备类型',
      dataIndex: 'deviceType',
      width: 130,
      render: (v: string) =>
        DEVICE_TYPE_LABEL[v as keyof typeof DEVICE_TYPE_LABEL] || '未知设备类型',
    },
    {
      title: 'AI 结果',
      width: 140,
      render: (_, row) => {
        const a = row.aiSummary;
        if (!a) return '-';
        if (a.fail > 0) return <Tag color="error">不合格 {a.fail}</Tag>;
        if (a.pending > 0) return <Tag color="processing">分析中 {a.pending}</Tag>;
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
      width: 100,
      render: (_, row) => (
        <Button type="link" onClick={() => openDetail(row.id)}>
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
        工程师提交后的报告都会出现在这里（含 AI 合格与不合格）。不合格待审报告可在「报告审核」处理；详情内可看完整操作链。
      </p>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          placeholder="任务/项目名称"
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
          placeholder="站点"
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
        <Button onClick={handleExport}>导出表格</Button>
        <Button
          type="primary"
          onClick={() => {
            setCompareDeviceId(deviceId);
            setSelectedRowKeys([]);
            if (!deviceId) message.info('请先选择设备，再勾选记录进行对比');
          }}
        >
          横向对比
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        rowSelection={
          deviceId
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }
            : undefined
        }
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        footer={
          deviceId && selectedRowKeys.length >= 2
            ? () => (
                <Button type="primary" onClick={() => void handleCompare()}>
                  对比已选 {selectedRowKeys.length} 条记录
                </Button>
              )
            : undefined
        }
      />

      <Drawer
        title={detail?.task?.taskName || '记录详情'}
        width={760}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {detail ? (
          <>
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
                  <Tag
                    color={
                      entry.aiResult?.status === 'pass'
                        ? 'success'
                        : entry.aiResult?.status === 'fail'
                          ? 'error'
                          : 'default'
                    }
                  >
                    智能分析：{CHECK_RESULT_LABEL[entry.aiResult?.status || 'pending'] || '待人工判断'}（
                    {((entry.aiResult?.confidence || 0) * 100).toFixed(0)}%)
                  </Tag>
                  <Tag color={entry.finalResult === 'fail' ? 'error' : 'success'}>
                    最终结论：{CHECK_RESULT_LABEL[entry.finalResult || 'pending'] || '待人工判断'}
                  </Tag>
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
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                {rec.submittedAt
                  ? new Date(rec.submittedAt).toLocaleDateString()
                  : rec.id.slice(0, 8)}
              </div>
              <Tag>{STATUS_MAP[rec.status]?.text || '未知状态'}</Tag>
              {rec.entries.map((entry) => (
                <div key={entry.templateEntryId} style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13 }}>{tplName(rec, entry.templateEntryId)}</div>
                  <Tag
                    color={entry.finalResult === 'fail' ? 'error' : 'success'}
                    style={{ marginTop: 4 }}
                  >
                    {CHECK_RESULT_LABEL[entry.finalResult || 'pending'] || '待人工判断'}
                  </Tag>
                  {(entry.photos || []).slice(0, 1).map((url) => (
                    <Image key={url} src={displayPhotoUrl(url)} width={80} height={80} style={{ marginTop: 4 }} />
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
