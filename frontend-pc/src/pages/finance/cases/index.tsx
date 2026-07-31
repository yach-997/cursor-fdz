import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  SettingOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import {
  assignFinanceCase,
  batchAssignFinanceCasesToSites,
  batchCreateTasksFromCases,
  clearFinanceCases,
  fetchFinanceCase,
  fetchFinanceCases,
  fetchFinanceInspectors,
  setFinanceCaseSite,
  setFinanceCaseTaskType,
} from '../../../api/finance';
import { fetchDevices } from '../../../api/device';
import { fetchSiteMembers, fetchSites } from '../../../api/site';
import type { FinanceCase, FinanceInspectorOption } from '../../../types/finance';
import type { DeviceItem, SiteItem } from '../../../types';
import { useAuthStore } from '../../../stores/auth';
import ImportDialog from '../components/ImportDialog';
import { canUseDangerousClear, confirmDangerousClear } from '../../../utils/finance-clear';

const statusLabel: Record<string, string> = {
  pending_assign: '待派单',
  assigned: '已派单',
  working: '作业中',
  finished: '已完工',
  settle_review: '待结算审核',
  settled: '已结算',
  month_locked: '已月结',
};

const taskTypeLabel: Record<string, string> = {
  inspection: '巡检',
  service: '服务作业',
};

export default function FinanceCasesPage() {
  const user = useAuthStore((s) => s.user);
  const admin = user?.role === 'super_admin';
  const canClear = admin && canUseDangerousClear();
  const [data, setData] = useState<FinanceCase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>();
  const [siteBind, setSiteBind] = useState<'unassigned' | 'assigned_site'>();
  const [filterSiteId, setFilterSiteId] = useState<string>();
  const [filterTaskType, setFilterTaskType] = useState<'inspection' | 'service'>();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Record<string, any>>();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [assigning, setAssigning] = useState<FinanceCase>();
  const [inspectors, setInspectors] = useState<FinanceInspectorOption[]>([]);
  const [inspectorId, setInspectorId] = useState<string>();
  const [assignReason, setAssignReason] = useState('');
  const [siteModal, setSiteModal] = useState<{ mode: 'single' | 'batch'; case?: FinanceCase }>();
  const [siteId, setSiteId] = useState<string>();
  const [typeModal, setTypeModal] = useState<FinanceCase>();
  const [taskType, setTaskType] = useState<'inspection' | 'service'>();
  const [batchTaskOpen, setBatchTaskOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [siteMembers, setSiteMembers] = useState<
    Array<{ userId: string; user: { realName: string; phone: string } | null }>
  >([]);
  const [batchDeviceId, setBatchDeviceId] = useState<string>();
  const [batchInspectorId, setBatchInspectorId] = useState<string>();

  const selectedCases = useMemo(
    () => data.filter((item) => selectedRowKeys.includes(item.id)),
    [data, selectedRowKeys],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchFinanceCases({
        page,
        limit: 10,
        keyword,
        status,
        siteBind,
        siteId: filterSiteId,
        taskType: filterTaskType,
      });
      setData(r.list);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, status, siteBind, filterSiteId, filterTaskType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchSites({ limit: 200 }).then((r) => setSites(r.list));
  }, []);

  const onClear = async () => {
    const ok = await confirmDangerousClear({
      title: '清空全部案例？',
      description:
        '将删除全部费用案例及关联作业记录、绩效台账。已挂接的 PO 会解除匹配变为待匹配，PO 明细本身不会删除。',
    });
    if (!ok) return;
    setClearing(true);
    try {
      const result = await clearFinanceCases();
      message.success(`已清空 ${result.deleted} 条案例`);
      setPage(1);
      await load();
    } finally {
      setClearing(false);
    }
  };

  const openBatchTasks = async () => {
    if (!selectedCases.length) {
      message.warning('请先勾选案例');
      return;
    }
    const siteIds = [...new Set(selectedCases.map((c) => c.siteId).filter(Boolean))];
    if (siteIds.length !== 1) {
      message.warning('批量建任务要求所选案例已归属同一站点');
      return;
    }
    const sid = siteIds[0] as string;
    const [deviceRes, members] = await Promise.all([
      fetchDevices({ siteId: sid, limit: 200 }),
      fetchSiteMembers(sid, 'inspector'),
    ]);
    setDevices(deviceRes.list);
    setSiteMembers(members);
    setBatchDeviceId(undefined);
    setBatchInspectorId(undefined);
    setBatchTaskOpen(true);
  };

  return (
    <Card className="finance-card">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="案例主流程"
        description="① 导入 GSP 案例表建案例 → ② 分配站点/设类型/派工程师现场作业 → ③ 完工后导入钉钉 PO 表（一张宽表，含案例信息与专用/通用条目）按案例号补价格 → ④ 工程师可查看收入；异常由区域审核人调整。"
      />
      <div className="finance-toolbar">
        <Input.Search
          allowClear
          placeholder="案例号或项目名称"
          onSearch={(v) => {
            setPage(1);
            setKeyword(v);
          }}
        />
        <Select
          allowClear
          placeholder="案例状态"
          value={status}
          onChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
          options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
        />
        <Select
          allowClear
          placeholder="站点归属"
          value={siteBind}
          onChange={(v) => {
            setPage(1);
            setSiteBind(v);
          }}
          options={[
            { value: 'unassigned', label: '未挂站点' },
            { value: 'assigned_site', label: '已挂站点' },
          ]}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="筛选站点"
          value={filterSiteId}
          onChange={(v) => {
            setPage(1);
            setFilterSiteId(v);
          }}
          options={sites.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          allowClear
          placeholder="任务类型"
          value={filterTaskType}
          onChange={(v) => {
            setPage(1);
            setFilterTaskType(v);
          }}
          options={[
            { value: 'inspection', label: '巡检' },
            { value: 'service', label: '服务作业' },
          ]}
        />
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => setOpen(true)}>
          导入案例
        </Button>
        <Button
          icon={<TeamOutlined />}
          disabled={!selectedRowKeys.length}
          onClick={() => {
            setSiteId(undefined);
            setSiteModal({ mode: 'batch' });
          }}
        >
          批量分配站点
        </Button>
        <Button icon={<SettingOutlined />} disabled={!selectedRowKeys.length} onClick={() => void openBatchTasks()}>
          批量建任务
        </Button>
        {canClear && (
          <Button danger icon={<DeleteOutlined />} loading={clearing} onClick={() => void onClear()}>
            清空全部案例
          </Button>
        )}
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        scroll={{ x: 1280 }}
        columns={[
          { title: '案例号', dataIndex: 'gspCaseNo', width: 150 },
          { title: '项目名称', dataIndex: 'projectName' },
          {
            title: '归属站点',
            dataIndex: 'siteName',
            width: 140,
            render: (v, r) => v || (r.siteId ? r.siteId.slice(0, 8) : <Tag>未分配</Tag>),
          },
          {
            title: '任务类型',
            dataIndex: 'taskType',
            width: 100,
            render: (v) => (v ? <Tag color="blue">{taskTypeLabel[v] || v}</Tag> : <Tag>未设置</Tag>),
          },
          { title: '省份', dataIndex: 'province', width: 80 },
          {
            title: '区域',
            dataIndex: 'region',
            width: 90,
            render: (v) => (v === 'yunnan' ? '云南' : '华南'),
          },
          { title: '服务类型', dataIndex: 'serviceType', width: 100 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (v) => <Tag color="green">{statusLabel[v] || v}</Tag>,
          },
          {
            title: '案例收入',
            dataIndex: 'caseRevenue',
            width: 120,
            render: (v) => <span className="finance-money">¥ {Number(v).toFixed(2)}</span>,
          },
          {
            title: '操作',
            width: 280,
            fixed: 'right',
            render: (_, r) => (
              <Space wrap size={0}>
                <Button
                  type="link"
                  onClick={() => {
                    setSiteId(r.siteId || undefined);
                    setSiteModal({ mode: 'single', case: r });
                  }}
                >
                  分配站点
                </Button>
                <Button
                  type="link"
                  disabled={!r.siteId}
                  onClick={() => {
                    setTaskType(r.taskType || undefined);
                    setTypeModal(r);
                  }}
                >
                  设类型
                </Button>
                {r.status === 'pending_assign' && (
                  <Button
                    type="link"
                    icon={<UserAddOutlined />}
                    disabled={!r.siteId || !r.taskType}
                    onClick={() => {
                      setAssigning(r);
                      setInspectorId(undefined);
                      setAssignReason('');
                      void fetchFinanceInspectors(r.id).then(setInspectors);
                    }}
                  >
                    派单
                  </Button>
                )}
                <Button
                  type="link"
                  icon={<EyeOutlined />}
                  onClick={() => void fetchFinanceCase(r.id).then(setDetail)}
                >
                  详情
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <ImportDialog
        open={open}
        kind="gsp"
        title="导入 GSP 案例"
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          void load();
        }}
      />
      <Modal
        open={!!siteModal}
        title={siteModal?.mode === 'batch' ? '批量分配到站点' : `分配站点 · ${siteModal?.case?.gspCaseNo || ''}`}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ disabled: !siteId }}
        onCancel={() => setSiteModal(undefined)}
        onOk={async () => {
          if (!siteId || !siteModal) return;
          if (siteModal.mode === 'batch') {
            const ids = selectedRowKeys.map(String);
            const result = await batchAssignFinanceCasesToSites(ids, siteId);
            message.success(`已将 ${result.updated} 个案例分配到「${result.siteName}」`);
            setSelectedRowKeys([]);
          } else if (siteModal.case) {
            await setFinanceCaseSite(siteModal.case.id, siteId);
            message.success('站点已更新');
          }
          setSiteModal(undefined);
          await load();
        }}
      >
        <Select
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
          value={siteId}
          placeholder="选择归属站点"
          onChange={setSiteId}
          options={sites.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` }))}
        />
      </Modal>
      <Modal
        open={!!typeModal}
        title={`设置任务类型 · ${typeModal?.gspCaseNo || ''}`}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ disabled: !taskType }}
        onCancel={() => setTypeModal(undefined)}
        onOk={async () => {
          if (!typeModal || !taskType) return;
          await setFinanceCaseTaskType(typeModal.id, taskType);
          message.success('任务类型已设置');
          setTypeModal(undefined);
          await load();
        }}
      >
        <p>巡检：将创建巡检任务走模板拍照；服务作业：工程师在费用案例中登记工作量。</p>
        <Select
          style={{ width: '100%' }}
          value={taskType}
          placeholder="选择任务类型"
          onChange={setTaskType}
          options={[
            { value: 'inspection', label: '巡检' },
            { value: 'service', label: '服务作业' },
          ]}
        />
      </Modal>
      <Modal
        open={batchTaskOpen}
        title="按案例批量建任务 / 派单"
        okText="执行"
        cancelText="取消"
        width={560}
        onCancel={() => setBatchTaskOpen(false)}
        onOk={async () => {
          const hasInspection = selectedCases.some((c) => c.taskType === 'inspection');
          const hasService = selectedCases.some((c) => c.taskType === 'service');
          if (hasInspection && !batchDeviceId) {
            message.warning('所选含巡检案例，请指定本站设备');
            return;
          }
          if (hasService && !batchInspectorId) {
            message.warning('所选含服务作业案例，请指定本站工程师');
            return;
          }
          const result = await batchCreateTasksFromCases({
            caseIds: selectedCases.map((c) => c.id),
            deviceId: batchDeviceId,
            inspectorId: batchInspectorId,
          });
          message.success(
            `巡检任务 ${result.createdTasks} 个，服务派单 ${result.serviceAssigned} 个` +
              (result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''),
          );
          if (result.skipped.length) {
            Modal.info({
              title: '部分案例未处理',
              width: 520,
              content: (
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {result.skipped.slice(0, 20).map((item) => (
                    <li key={item.caseId}>
                      {item.caseId}: {item.reason}
                    </li>
                  ))}
                </ul>
              ),
            });
          }
          setBatchTaskOpen(false);
          setSelectedRowKeys([]);
          await load();
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`已选 ${selectedCases.length} 个案例（须同一站点、已设任务类型）`}
        />
        {selectedCases.some((c) => c.taskType === 'inspection') && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>巡检设备（本批共用）</div>
            <Select
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              value={batchDeviceId}
              placeholder="选择设备"
              onChange={setBatchDeviceId}
              options={devices.map((d) => ({
                value: d.id,
                label: `${d.serialNumber}${d.model ? ` · ${d.model}` : ''}`,
              }))}
            />
          </div>
        )}
        <div>
          <div style={{ marginBottom: 6 }}>本站工程师（可选；服务作业必填）</div>
          <Select
            style={{ width: '100%' }}
            allowClear
            showSearch
            optionFilterProp="label"
            value={batchInspectorId}
            placeholder="选择工程师"
            onChange={setBatchInspectorId}
            options={siteMembers.map((m) => ({
              value: m.userId,
              label: `${m.user?.realName || m.userId}（${m.user?.phone || '-'}）`,
            }))}
          />
        </div>
      </Modal>
      <Modal
        open={!!assigning}
        title={`派本站工程师 · ${assigning?.gspCaseNo || ''}`}
        okText="确认派单"
        cancelText="取消"
        okButtonProps={{ disabled: !inspectorId }}
        onCancel={() => setAssigning(undefined)}
        onOk={async () => {
          if (!assigning || !inspectorId) return;
          await assignFinanceCase(assigning.id, inspectorId, assignReason || undefined);
          message.success('派单成功，工程师可在手机端接单作业');
          setAssigning(undefined);
          await load();
        }}
      >
        <p>仅显示该站点已入职工程师。</p>
        <Select
          style={{ width: '100%' }}
          value={inspectorId}
          placeholder="选择空闲工程师"
          onChange={setInspectorId}
          options={inspectors.map((item) => ({
            value: item.id,
            disabled: !item.available,
            label: `${item.realName}（${item.phone}）${item.available ? '' : ' · 作业中'}`,
          }))}
        />
        <Input.TextArea
          style={{ marginTop: 12 }}
          rows={2}
          value={assignReason}
          onChange={(event) => setAssignReason(event.target.value)}
          placeholder="派单备注（选填）"
        />
      </Modal>
      <Drawer
        width={760}
        open={!!detail}
        title={detail?.projectName || '案例详情'}
        onClose={() => setDetail(undefined)}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              column={2}
              items={[
                { key: 'no', label: '案例号', children: detail.gspCaseNo },
                {
                  key: 'region',
                  label: '区域',
                  children: detail.region === 'yunnan' ? '云南' : '华南',
                },
                { key: 'province', label: '省份', children: detail.province || '-' },
                {
                  key: 'site',
                  label: '归属站点',
                  children: detail.siteName || detail.siteId || '-',
                },
                {
                  key: 'taskType',
                  label: '任务类型',
                  children: detail.taskType ? taskTypeLabel[detail.taskType] || detail.taskType : '-',
                },
                {
                  key: 'status',
                  label: '状态',
                  children: statusLabel[detail.status] || detail.status,
                },
              ]}
            />
            {detail.reconciliation?.warning && (
              <Alert
                className="finance-warning"
                style={{ marginTop: 16 }}
                type="warning"
                showIcon
                message={detail.reconciliation.warning}
                description={`PO总额 ¥${detail.reconciliation.poTotal}，已核算收入 ¥${detail.reconciliation.caseRevenue}`}
              />
            )}
            <div className="finance-detail-section">
              <h3>PO 与核算条目</h3>
              {(detail.orders || []).map((po: any) => (
                <Card
                  size="small"
                  key={po.id}
                  title={`${po.poNo} · ¥${po.poTotalAmount}`}
                  style={{ marginBottom: 10 }}
                >
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={po.items}
                    columns={[
                      {
                        title: '类别',
                        dataIndex: 'itemCategory',
                        render: (v) => (v === 'special' ? '专用' : '通用'),
                      },
                      { title: '条目', dataIndex: 'itemName' },
                      { title: '数量', dataIndex: 'qty' },
                      {
                        title: '状态',
                        dataIndex: 'priceStatus',
                        width: 100,
                        render: (v: string) => {
                          if (v === 'ignored') return <Tag>已忽略</Tag>;
                          if (v === 'pending_price') return <Tag color="warning">待定价</Tag>;
                          if (v === 'ok') return <Tag color="success">已定价</Tag>;
                          return <Tag>{v || '-'}</Tag>;
                        },
                      },
                      {
                        title: '结算单价',
                        dataIndex: 'settlePrice',
                        render: (v, row: { priceStatus?: string }) =>
                          row.priceStatus === 'ignored' ? '—' : v ? `¥${v}` : '待定价',
                      },
                      {
                        title: '收入',
                        dataIndex: 'itemRevenue',
                        render: (v, row: { priceStatus?: string }) =>
                          row.priceStatus === 'ignored' ? '—' : `¥${v}`,
                      },
                    ]}
                  />
                </Card>
              ))}
            </div>
          </>
        )}
      </Drawer>
    </Card>
  );
}
