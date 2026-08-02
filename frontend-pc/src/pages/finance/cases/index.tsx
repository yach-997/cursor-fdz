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
  downloadFinanceImportTemplate,
  fetchFinanceCase,
  fetchFinanceCases,
  fetchFinanceInspectors,
  setFinanceCaseSite,
  setFinanceCaseTaskType,
} from '../../../api/finance';
import { fetchSiteMembers, fetchSites } from '../../../api/site';
import { fetchTemplates, type TemplateItem } from '../../../api/template';
import type { FinanceCase, FinanceInspectorOption } from '../../../types/finance';
import type { SiteItem } from '../../../types';
import { useAuthStore } from '../../../stores/auth';
import ImportDialog from '../components/ImportDialog';
import { canUseDangerousClear, confirmDangerousClear } from '../../../utils/finance-clear';

const dispatchStatusLabel: Record<string, string> = {
  pending_assign: '待派单',
  assigned: '已派单',
  working: '作业中',
  finished: '已完工',
  settle_review: '待结算审核',
  settled: '已结算',
  month_locked: '已月结',
};

const legacyTaskTypeLabel: Record<string, string> = {
  inspection: '巡检',
  service: '服务作业',
};

function displayTaskType(c: Pick<FinanceCase, 'taskTypeName' | 'taskType' | 'taskTemplateId'>) {
  return c.taskTypeName || legacyTaskTypeLabel[String(c.taskType || '')] || c.taskType || null;
}

function hasTaskType(c: Pick<FinanceCase, 'taskTypeName' | 'taskType' | 'taskTemplateId'>) {
  return !!(c.taskTemplateId || c.taskType);
}

/** 派单/作业进度（与「归属站点」列区分开） */
function dispatchStatus(c: FinanceCase) {
  const text = dispatchStatusLabel[c.status] || c.status;
  if (c.status === 'pending_assign') return { text, color: 'warning' as const };
  if (c.status === 'working') return { text, color: 'processing' as const };
  if (c.status === 'assigned') return { text, color: 'blue' as const };
  return { text, color: 'green' as const };
}

export default function FinanceCasesPage() {
  const user = useAuthStore((s) => s.user);
  const admin = user?.role === 'super_admin';
  const isManager = user?.role === 'site_manager';
  const canClear = admin && canUseDangerousClear();
  const [data, setData] = useState<FinanceCase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>();
  const [siteBind, setSiteBind] = useState<'unassigned' | 'assigned_site'>();
  const [filterSiteId, setFilterSiteId] = useState<string>();
  const [filterTaskType, setFilterTaskType] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Record<string, any>>();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [taskTypes, setTaskTypes] = useState<TemplateItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [assigning, setAssigning] = useState<FinanceCase>();
  const [inspectors, setInspectors] = useState<FinanceInspectorOption[]>([]);
  const [inspectorId, setInspectorId] = useState<string>();
  const [assignReason, setAssignReason] = useState('');
  const [siteModal, setSiteModal] = useState<{ mode: 'single' | 'batch'; case?: FinanceCase }>();
  const [siteId, setSiteId] = useState<string>();
  const [typeModal, setTypeModal] = useState<FinanceCase>();
  const [taskTemplateId, setTaskTemplateId] = useState<string>();
  const [batchTaskOpen, setBatchTaskOpen] = useState(false);
  const [siteMembers, setSiteMembers] = useState<
    Array<{ userId: string; user: { realName: string; phone: string } | null }>
  >([]);
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
    void fetchSites({ limit: 100 }).then((r) => setSites(r.list));
    void fetchTemplates().then(setTaskTypes).catch(() => setTaskTypes([]));
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
      message.warning('批量派单要求所选案例已归属同一站点');
      return;
    }
    if (selectedCases.some((c) => !hasTaskType(c))) {
      message.warning('请先为所选案例设置任务类型（在「任务类型」中维护）');
      return;
    }
    const sid = siteIds[0] as string;
    const members = await fetchSiteMembers(sid, 'inspector');
    setSiteMembers(members);
    setBatchInspectorId(undefined);
    setBatchTaskOpen(true);
  };

  return (
    <Card className="finance-card">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={admin ? '管理员：分配/改派站点；可协助设类型与派单' : '网格长：设类型、派单与改派工程师'}
        description={
          admin
            ? '分配错站点可改派到其他网格长站点（将清空原工程师派单）。派错工程师可改派。巡检报告已提交后不可改派。'
            : '管理员分配站点后，请设类型并派单；派错工程师可改派给本站其他工程师。巡检报告已提交后不可改派。'
        }
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
        {admin ? (
          <Select
            allowClear
            placeholder="站点归属"
            value={siteBind}
            onChange={(v) => {
              setPage(1);
              setSiteBind(v);
            }}
            options={[
              { value: 'unassigned', label: '未分配站点' },
              { value: 'assigned_site', label: '已分配站点' },
            ]}
          />
        ) : (
          <Select
            allowClear
            placeholder="派单状态"
            value={status}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
            options={Object.entries(dispatchStatusLabel).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        )}
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
          showSearch
          optionFilterProp="label"
          placeholder="任务类型"
          value={filterTaskType}
          onChange={(v) => {
            setPage(1);
            setFilterTaskType(v);
          }}
          options={taskTypes.map((t) => ({ value: t.id, label: t.name }))}
        />
        {admin && (
          <>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                void downloadFinanceImportTemplate('gsp').catch(() => undefined);
              }}
            >
              下载模板
            </Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => setOpen(true)}>
              导入案例
            </Button>
            <Button
              type="primary"
              icon={<TeamOutlined />}
              disabled={!selectedRowKeys.length}
              onClick={() => {
                setSiteId(undefined);
                setSiteModal({ mode: 'batch' });
              }}
            >
              批量分配/改派站点
            </Button>
          </>
        )}
        {(admin || isManager) && (
          <Button
            type={isManager ? 'primary' : 'default'}
            icon={<SettingOutlined />}
            disabled={!selectedRowKeys.length}
            onClick={() => void openBatchTasks()}
          >
            批量派单
          </Button>
        )}
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
        scroll={{ x: 1680 }}
        columns={[
          { title: '服务案例号', dataIndex: 'gspCaseNo', width: 150, fixed: 'left' },
          { title: '项目名称', dataIndex: 'projectName', width: 220, ellipsis: true },
          { title: '服务类型', dataIndex: 'serviceType', width: 100 },
          { title: '创建人', dataIndex: 'creator', width: 90, render: (v) => v || '-' },
          { title: '省份', dataIndex: 'province', width: 80, render: (v) => v || '-' },
          { title: '城市', dataIndex: 'city', width: 90, render: (v) => v || '-' },
          {
            title: '失效现象描述',
            dataIndex: 'siteDesc',
            width: 220,
            ellipsis: true,
            render: (v) => v || '-',
          },
          {
            title: '归属站点',
            dataIndex: 'siteName',
            width: 160,
            render: (v, r) =>
              v ? (
                <span>
                  {v}
                  {r.siteManagerName ? (
                    <span style={{ color: '#8c8c8c', display: 'block', fontSize: 12 }}>
                      网格长：{r.siteManagerName}
                    </span>
                  ) : null}
                </span>
              ) : r.siteId ? (
                r.siteId.slice(0, 8)
              ) : (
                <Tag>未分配</Tag>
              ),
          },
          {
            title: '工程师',
            dataIndex: 'inspectorName',
            width: 100,
            render: (v) => v || <span style={{ color: '#bfbfbf' }}>-</span>,
          },
          {
            title: '任务类型',
            dataIndex: 'taskTypeName',
            width: 140,
            ellipsis: true,
            render: (_, r) => {
              const label = displayTaskType(r);
              return label ? <Tag color="blue">{label}</Tag> : <Tag>未设置</Tag>;
            },
          },
          {
            title: '区域',
            dataIndex: 'region',
            width: 90,
            render: (v) => (v === 'yunnan' ? '云南' : '华南'),
          },
          {
            title: '派单状态',
            dataIndex: 'status',
            width: 120,
            render: (_, r) => {
              const s = dispatchStatus(r);
              return <Tag color={s.color}>{s.text}</Tag>;
            },
          },
          {
            title: '案例收入',
            dataIndex: 'caseRevenue',
            width: 120,
            render: (v) => <span className="finance-money">¥ {Number(v).toFixed(2)}</span>,
          },
          {
            title: '操作',
            width: 300,
            fixed: 'right',
            render: (_, r) => (
              <Space wrap size={0}>
                {admin &&
                  !['finished', 'settle_review', 'settled', 'month_locked'].includes(r.status) && (
                  <Button
                    type="link"
                    style={!r.siteId ? { fontWeight: 600 } : undefined}
                    onClick={() => {
                      setSiteId(r.siteId || undefined);
                      setSiteModal({ mode: 'single', case: r });
                    }}
                  >
                    {r.siteId ? '改派站点' : '分配站点'}
                  </Button>
                )}
                <Button
                  type="link"
                  style={isManager && r.siteId && !hasTaskType(r) ? { fontWeight: 600 } : undefined}
                  disabled={!r.siteId}
                  onClick={() => {
                    setTaskTemplateId(r.taskTemplateId || undefined);
                    setTypeModal(r);
                  }}
                >
                  设类型
                </Button>
                {['pending_assign', 'assigned', 'working'].includes(r.status) && (
                  <Button
                    type="link"
                    style={
                      isManager && r.siteId && hasTaskType(r) && r.status === 'pending_assign'
                        ? { fontWeight: 600 }
                        : undefined
                    }
                    icon={<UserAddOutlined />}
                    disabled={!r.siteId || !hasTaskType(r)}
                    onClick={() => {
                      setAssigning(r);
                      setInspectorId(r.inspectorId || undefined);
                      setAssignReason('');
                      void fetchFinanceInspectors(r.id).then(setInspectors);
                    }}
                  >
                    {r.status === 'pending_assign' ? '派单' : '改派工程师'}
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
      {admin && (
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
      )}
      <Modal
        open={!!siteModal}
        title={
          siteModal?.mode === 'batch'
            ? '批量分配/改派到站点'
            : `${siteModal?.case?.siteId ? '改派站点' : '分配站点'} · ${siteModal?.case?.gspCaseNo || ''}`
        }
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
            if (result.skipped?.length) {
              Modal.info({
                title: '部分案例未改派',
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
            setSelectedRowKeys([]);
          } else if (siteModal.case) {
            const wasAssigned = !!siteModal.case.siteId;
            const hadDispatch = siteModal.case.status !== 'pending_assign' || !!siteModal.case.inspectorId;
            await setFinanceCaseSite(siteModal.case.id, siteId);
            message.success(
              wasAssigned
                ? hadDispatch
                  ? '已改派站点，原工程师派单已清空，请新站点重新派单'
                  : '已改派站点'
                : '站点已分配',
            );
          }
          setSiteModal(undefined);
          await load();
        }}
      >
        {!!siteModal?.case?.siteId && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="改派到其他站点后，原工程师派单与未提交巡检将清空，需由新站点网格长重新派单。"
          />
        )}
        <Select
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
          value={siteId}
          placeholder="选择归属站点（对应网格长）"
          onChange={setSiteId}
          options={sites.map((s) => ({
            value: s.id,
            label: `${s.name}（网格长：${s.manager?.realName || '未任命'}）`,
          }))}
        />
      </Modal>
      <Modal
        open={!!typeModal}
        title={`设置任务类型 · ${typeModal?.gspCaseNo || ''}`}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ disabled: !taskTemplateId }}
        onCancel={() => setTypeModal(undefined)}
        onOk={async () => {
          if (!typeModal || !taskTemplateId) return;
          await setFinanceCaseTaskType(typeModal.id, taskTemplateId);
          message.success('任务类型已设置');
          setTypeModal(undefined);
          await load();
        }}
      >
        <p style={{ marginBottom: 12 }}>
          从「任务类型」中选择类型（如组串、集中、储能等，可自行新建）。工程师按该类型对应的检查条目开展作业。
        </p>
        <Select
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
          value={taskTemplateId}
          placeholder={taskTypes.length ? '选择任务类型' : '请先在「任务类型」新建类型'}
          onChange={setTaskTemplateId}
          options={taskTypes.map((t) => ({
            value: t.id,
            label: `${t.name}（${t.entries?.length || 0} 项）`,
          }))}
        />
      </Modal>
      <Modal
        open={batchTaskOpen}
        title="按案例批量派单"
        okText="派单"
        cancelText="取消"
        width={560}
        onCancel={() => setBatchTaskOpen(false)}
        onOk={async () => {
          if (!batchInspectorId) {
            message.warning('请指定本站工程师');
            return;
          }
          const result = await batchCreateTasksFromCases({
            caseIds: selectedCases.map((c) => c.id),
            inspectorId: batchInspectorId,
          });
          message.success(
            `已派单 ${result.serviceAssigned} 个` +
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
          message={`已选 ${selectedCases.length} 个案例（须同一站点、已设任务类型、待派单）`}
        />
        <div>
          <div style={{ marginBottom: 6 }}>本站工程师</div>
          <Select
            style={{ width: '100%' }}
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
        title={`${assigning && assigning.status !== 'pending_assign' ? '改派工程师' : '派本站工程师'} · ${assigning?.gspCaseNo || ''}`}
        okText={assigning && assigning.status !== 'pending_assign' ? '确认改派' : '确认派单'}
        cancelText="取消"
        okButtonProps={{ disabled: !inspectorId }}
        onCancel={() => setAssigning(undefined)}
        onOk={async () => {
          if (!assigning || !inspectorId) return;
          const reassign = assigning.status !== 'pending_assign';
          await assignFinanceCase(assigning.id, inspectorId, assignReason || undefined);
          message.success(
            reassign
              ? '已改派工程师，原工程师手机端将不再看到该案例'
              : '派单成功，工程师可在手机端接单作业',
          );
          setAssigning(undefined);
          await load();
        }}
      >
        {assigning && assigning.status !== 'pending_assign' ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="可将案例从当前工程师转移到本站其他工程师；未提交的巡检进度会随任务一并转移。"
          />
        ) : (
          <p>仅显示该站点已入职工程师；同一工程师可同时负责多个案例。</p>
        )}
        <Select
          style={{ width: '100%' }}
          value={inspectorId}
          placeholder="选择工程师"
          onChange={setInspectorId}
          options={inspectors.map((item) => ({
            value: item.id,
            label: `${item.realName}（${item.phone}）${
              item.activeCaseCount ? ` · 在办 ${item.activeCaseCount} 单` : ''
            }`,
          }))}
        />
        <Input.TextArea
          style={{ marginTop: 12 }}
          rows={2}
          value={assignReason}
          onChange={(event) => setAssignReason(event.target.value)}
          placeholder={
            assigning && assigning.status !== 'pending_assign'
              ? '改派原因（选填）'
              : '派单备注（选填）'
          }
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
                { key: 'no', label: '服务案例号', children: detail.gspCaseNo },
                { key: 'project', label: '项目名称', children: detail.projectName || '-' },
                { key: 'serviceType', label: '服务类型', children: detail.serviceType || '-' },
                { key: 'creator', label: '创建人', children: detail.creator || '-' },
                { key: 'province', label: '省份', children: detail.province || '-' },
                { key: 'city', label: '城市', children: detail.city || '-' },
                {
                  key: 'siteDesc',
                  label: '失效现象描述',
                  span: 2,
                  children: detail.siteDesc || '-',
                },
                {
                  key: 'region',
                  label: '区域',
                  children: detail.region === 'yunnan' ? '云南' : '华南',
                },
                {
                  key: 'site',
                  label: '归属站点',
                  children: detail.siteName
                    ? `${detail.siteName}${detail.siteManagerName ? `（网格长：${detail.siteManagerName}）` : ''}`
                    : detail.siteId || '-',
                },
                {
                  key: 'inspector',
                  label: '工程师',
                  children: detail.inspectorName || detail.inspectorId || '-',
                },
                {
                  key: 'taskType',
                  label: '任务类型',
                  children: displayTaskType(detail) || '-',
                },
                {
                  key: 'status',
                  label: '派单状态',
                  children: dispatchStatus(detail as FinanceCase).text,
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
