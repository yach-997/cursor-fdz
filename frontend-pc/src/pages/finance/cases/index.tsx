import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
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
  Tooltip,
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
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  assignFinanceCase,
  batchAssignFinanceCasesToSites,
  batchCreateTasksFromCases,
  clearFinanceCases,
  downloadFinanceImportTemplate,
  fetchFinanceCase,
  fetchFinanceCases,
  fetchFinanceCaseLocationOptions,
  fetchFinanceInspectors,
  setFinanceCaseSite,
  setFinanceCaseTaskType,
  setFinanceCaseWorkPlan,
  withdrawFinanceAssignee,
} from '../../../api/finance';
import { fetchSiteMembers, fetchSites } from '../../../api/site';
import { fetchTemplates, type TemplateItem } from '../../../api/template';
import type { FinanceCase, FinanceInspectorOption } from '../../../types/finance';
import type { SiteItem } from '../../../types';
import { useAuthStore } from '../../../stores/auth';
import ImportDialog from '../components/ImportDialog';
import { canUseDangerousClear, confirmDangerousClear } from '../../../utils/finance-clear';

function inspectorOptionLabel(item: {
  realName?: string;
  username?: string;
  phone?: string;
  activeCaseCount?: number;
}) {
  const name = String(item.realName || '').trim() || String(item.username || '').trim() || '未命名';
  const username = String(item.username || '').trim();
  const phone = String(item.phone || '').trim();
  const phonePart = phone && phone !== '-' ? `（${phone}）` : '';
  const user =
    username && username !== name && username !== phone ? ` · ${username}` : '';
  const busy = item.activeCaseCount ? ` · 在办 ${item.activeCaseCount} 单` : '';
  return `${name}${user}${phonePart}${busy}`;
}

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

/** 产品线精确匹配缺口：缺填 / 系统尚未配置同名产品线 */
function productLineGap(
  c: Pick<FinanceCase, 'taskTemplateId' | 'productLine' | 'serviceType'>,
  templates: TemplateItem[],
): 'empty' | 'unconfigured' | 'unbound_type' | null {
  const demand = String(c.serviceType || '').trim();
  if (!c.taskTemplateId) {
    if (demand && !templates.some((t) => t.name === demand)) return 'unbound_type';
    return null;
  }
  const tpl = templates.find((t) => t.id === c.taskTemplateId);
  if (!tpl) return null;
  const lines = tpl.productLines || [];
  const pl = String(c.productLine || '').trim();
  // 案例带了产品线：必须在服务类型下精确同名存在（哪怕模板目前还没配任何产品线）
  if (pl) {
    if (!lines.some((l) => String(l.name || '').trim() === pl)) return 'unconfigured';
    return null;
  }
  // 案例未带产品线，但服务类型已配产品线 → 需补选
  if (lines.length) return 'empty';
  return null;
}

function needsProductLine(
  c: Pick<FinanceCase, 'taskTemplateId' | 'productLine' | 'serviceType'>,
  templates: TemplateItem[],
) {
  const gap = productLineGap(c, templates);
  return gap === 'empty' || gap === 'unconfigured';
}

/** 列表省略文案：悬停看全文 */
function EllipsisTip({
  text,
  empty = '-',
}: {
  text?: string | null;
  empty?: string;
}) {
  const t = String(text || '').trim();
  if (!t) return <span style={{ color: '#bfbfbf' }}>{empty}</span>;
  return (
    <Tooltip title={t}>
      <span
        style={{
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {t}
      </span>
    </Tooltip>
  );
}

/** 派单/作业进度（与「归属网格」列区分开） */
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<FinanceCase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') || '');
  const [status, setStatus] = useState<string>();
  const [province, setProvince] = useState<string>();
  const [city, setCity] = useState<string>();
  const [siteBind, setSiteBind] = useState<'unassigned' | 'assigned_site'>();
  const [filterSiteId, setFilterSiteId] = useState<string>();
  const [filterTaskType, setFilterTaskType] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Record<string, any>>();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [taskTypes, setTaskTypes] = useState<TemplateItem[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [citiesByProvince, setCitiesByProvince] = useState<Record<string, string[]>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [assigning, setAssigning] = useState<FinanceCase>();
  const [inspectors, setInspectors] = useState<FinanceInspectorOption[]>([]);
  const [inspectorId, setInspectorId] = useState<string>();
  const [inspectorIds, setInspectorIds] = useState<string[]>([]);
  const [plannedUnits, setPlannedUnits] = useState<number>(1);
  const [assignMode, setAssignMode] = useState<'single' | 'multi'>('single');
  const [assignReason, setAssignReason] = useState('');
  const [activeAssignees, setActiveAssignees] = useState<
    Array<{ id: string; realName: string; completedUnits?: number }>
  >([]);
  const assignLoadSeq = useRef(0);
  const assignModeTouched = useRef(false);
  const [siteModal, setSiteModal] = useState<{ mode: 'single' | 'batch'; case?: FinanceCase }>();
  const [siteId, setSiteId] = useState<string>();
  const [typeModal, setTypeModal] = useState<FinanceCase>();
  const [taskTemplateId, setTaskTemplateId] = useState<string>();
  const [productLine, setProductLine] = useState<string>();
  const [batchTaskOpen, setBatchTaskOpen] = useState(false);
  const [siteMembers, setSiteMembers] = useState<
    Array<{
      userId: string;
      user: { realName: string; phone: string; username?: string } | null;
    }>
  >([]);
  const [batchInspectorId, setBatchInspectorId] = useState<string>();
  const [planModal, setPlanModal] = useState<FinanceCase>();
  const [planUnits, setPlanUnits] = useState(1);

  const selectedCases = useMemo(
    () => data.filter((item) => selectedRowKeys.includes(item.id)),
    [data, selectedRowKeys],
  );

  const cityOptions = useMemo(
    () => (province ? citiesByProvince[province] || [] : []),
    [province, citiesByProvince],
  );

  const sitesInLocation = useMemo(() => {
    return sites.filter((s) => {
      if (province && s.province !== province) return false;
      if (city && s.city !== city) return false;
      return true;
    });
  }, [sites, province, city]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchFinanceCases({
        page,
        limit: 10,
        keyword,
        status,
        province,
        city,
        siteBind,
        siteId: filterSiteId,
        taskType: filterTaskType,
      });
      setData(r.list);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, status, province, city, siteBind, filterSiteId, filterTaskType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchSites({ limit: 100 }).then((r) => setSites(r.list));
    void fetchTemplates().then(setTaskTypes).catch(() => setTaskTypes([]));
    void fetchFinanceCaseLocationOptions()
      .then((r) => {
        setProvinces(r.provinces || []);
        setCitiesByProvince(r.citiesByProvince || {});
      })
      .catch(() => {
        setProvinces([]);
        setCitiesByProvince({});
      });
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
      message.warning('批量派单要求所选案例已归属同一网格');
      return;
    }
    if (selectedCases.some((c) => !hasTaskType(c))) {
      message.warning('请先为所选案例设置服务类型（在「服务类型」中维护）');
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
        message={admin ? '管理员：分配/改派网格；可协助设服务类型与派单' : '网格长：设服务类型、派单与改派工程师'}
        description={
          admin
            ? '建议批量：按省份/城市筛选 → 勾选未分配案例 → 批量分配网格 → 设服务类型 → 再批量派单（须同一网格）。改网格会清空全部原派单（须新网格重派）；设类型仅开工前可改；改工程师支持换人/加人/撤回（有完成进度或报告已交不可改）。'
            : '仅显示管理员已分配到本网格的案例。设类型仅开工前可改；改工程师支持换人/加人/撤回；报告已提交后不可改派。'
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
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="省份"
          value={province}
          onChange={(v) => {
            setPage(1);
            setProvince(v);
            setCity(undefined);
            setFilterSiteId(undefined);
            setSelectedRowKeys([]);
          }}
          options={provinces.map((p) => ({ value: p, label: p }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="城市"
          value={city}
          disabled={!province}
          onChange={(v) => {
            setPage(1);
            setCity(v);
            setFilterSiteId(undefined);
            setSelectedRowKeys([]);
          }}
          options={cityOptions.map((c) => ({ value: c, label: c }))}
        />
        {admin && (
          <Select
            allowClear
            placeholder="网格归属"
            value={siteBind}
            onChange={(v) => {
              setPage(1);
              setSiteBind(v);
              setSelectedRowKeys([]);
            }}
            options={[
              { value: 'unassigned', label: '未分配网格' },
              { value: 'assigned_site', label: '已分配网格' },
            ]}
          />
        )}
        <Select
          allowClear
          placeholder="派单状态"
          value={status}
          onChange={(v) => {
            setPage(1);
            setStatus(v);
            setSelectedRowKeys([]);
          }}
          options={Object.entries(dispatchStatusLabel).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="筛选网格"
          value={filterSiteId}
          onChange={(v) => {
            setPage(1);
            setFilterSiteId(v);
            setSelectedRowKeys([]);
          }}
          options={sitesInLocation.map((s) => ({
            value: s.id,
            label: `${s.name}${s.manager?.realName ? `（${s.manager.realName}）` : ''}`,
          }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="服务类型"
          style={{ width: 160 }}
          value={filterTaskType}
          onChange={(v) => {
            setPage(1);
            setFilterTaskType(v);
            setSelectedRowKeys([]);
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
              批量分配/改派网格
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
        size="middle"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        scroll={{ x: 1180 }}
        columns={[
          { title: '服务案例号', dataIndex: 'gspCaseNo', width: 140, fixed: 'left' },
          {
            title: '项目名称',
            dataIndex: 'projectName',
            width: 200,
            ellipsis: { showTitle: false },
            render: (v) => <EllipsisTip text={v} />,
          },
          {
            title: '类型 / 产品线',
            width: 200,
            render: (_, r) => {
              const typeLabel = displayTaskType(r) || String(r.serviceType || '').trim() || null;
              const pl = String(r.productLine || '').trim();
              const gap = productLineGap(r, taskTypes);
              const matched = hasTaskType(r);
              const goTemplateSetup = (e: MouseEvent) => {
                e.stopPropagation();
                const demand = String(r.serviceType || '').trim();
                const tpl =
                  (r.taskTemplateId && taskTypes.find((t) => t.id === r.taskTemplateId)) ||
                  (demand ? taskTypes.find((t) => t.name === demand) : undefined);
                const qs = new URLSearchParams();
                if (tpl) qs.set('templateId', tpl.id);
                else if (demand) qs.set('createName', demand);
                if (pl) qs.set('addLine', pl);
                navigate(`/templates?${qs.toString()}`);
              };
              return (
                <div style={{ lineHeight: 1.35, minWidth: 0 }}>
                  <div>
                    {typeLabel ? (
                      <Tag color={matched ? 'blue' : 'default'} style={{ marginInlineEnd: 4 }}>
                        {typeLabel}
                      </Tag>
                    ) : (
                      <Tag>未匹配类型</Tag>
                    )}
                    {r.assignMode === 'multi' ? <Tag color="purple">多人</Tag> : null}
                    {gap === 'unbound_type' ? (
                      <Tag
                        color="orange"
                        style={{ cursor: 'pointer' }}
                        onClick={goTemplateSetup}
                        title="点击前往服务类型新增"
                      >
                        待补类型
                      </Tag>
                    ) : null}
                  </div>
                  <Tooltip title={pl || undefined}>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 12,
                        color: '#595959',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {pl || <span style={{ color: '#bfbfbf' }}>无产品线</span>}
                      {gap === 'unconfigured' ? (
                        <Tag
                          color="orange"
                          style={{ marginLeft: 4, cursor: 'pointer' }}
                          onClick={goTemplateSetup}
                          title="点击前往服务类型新增该产品线"
                        >
                          待补产品线
                        </Tag>
                      ) : null}
                      {gap === 'empty' ? (
                        <Tag color="warning" style={{ marginLeft: 4 }}>
                          未选产品线
                        </Tag>
                      ) : null}
                    </div>
                  </Tooltip>
                </div>
              );
            },
          },
          {
            title: '地区',
            width: 100,
            render: (_, r) => {
              const text = [r.province, r.city].filter(Boolean).join(' · ') || '-';
              return <EllipsisTip text={text === '-' ? '' : text} />;
            },
          },
          {
            title: '归属网格',
            dataIndex: 'siteName',
            width: 140,
            render: (v, r) =>
              v ? (
                <Tooltip title={r.siteManagerName ? `网格长：${r.siteManagerName}` : v}>
                  <span>{v}</span>
                </Tooltip>
              ) : (
                <Tag>未分配</Tag>
              ),
          },
          {
            title: '工程师',
            dataIndex: 'inspectorName',
            width: 168,
            ellipsis: { showTitle: false },
            render: (v: string, row: FinanceCase) => {
              const names = String(v || '')
                .split(/[、,，]/)
                .map((s) => s.trim())
                .filter(Boolean);
              if (!names.length) return '-';
              const short =
                names.length > 2
                  ? `${names.slice(0, 2).join('、')}等${names.length}人`
                  : names.join('、');
              return (
                <span>
                  <EllipsisTip text={short} empty="-" />
                  {row.assignMode === 'multi' || names.length > 1 ? (
                    <Tag color="purple" style={{ marginLeft: 6 }}>
                      {names.length}人
                    </Tag>
                  ) : null}
                </span>
              );
            },
          },
          {
            title: '状态',
            width: 120,
            render: (_, r) => {
              const s = dispatchStatus(r);
              return (
                <div style={{ lineHeight: 1.35 }}>
                  <Tag color={s.color}>{s.text}</Tag>
                  {r.assignMode === 'multi' ? (
                    <div style={{ marginTop: 2, fontSize: 12, color: '#8c8c8c' }}>
                      {r.completedUnits || 0}/{r.plannedUnits || 1}
                      {r.unitLabel || '台'}
                    </div>
                  ) : null}
                </div>
              );
            },
          },
          {
            title: '操作',
            width: 220,
            fixed: 'right',
            render: (_, r) => {
              const typeActionNeeded =
                !hasTaskType(r) ||
                needsProductLine(r, taskTypes) ||
                productLineGap(r, taskTypes) === 'unbound_type';
              return (
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
                    {r.siteId ? '改网格' : '分配网格'}
                  </Button>
                )}
                {['pending_assign', 'assigned'].includes(r.status) && typeActionNeeded && (
                  <Button
                    type="link"
                    style={isManager && r.siteId ? { fontWeight: 600 } : undefined}
                    disabled={!r.siteId}
                    onClick={() => {
                      const demand = String(r.serviceType || '').trim();
                      const matched = demand
                        ? taskTypes.find((t) => t.name === demand)
                        : undefined;
                      const tplId = r.taskTemplateId || matched?.id || undefined;
                      setTaskTemplateId(tplId);
                      const tpl = taskTypes.find((t) => t.id === tplId);
                      const prefer = String(r.productLine || '').trim();
                      const lines = tpl?.productLines || [];
                      const matchedPl = prefer
                        ? lines.find((p) => String(p.name || '').trim() === prefer)
                        : undefined;
                      setProductLine(matchedPl?.name || prefer || undefined);
                      setTypeModal(r);
                    }}
                  >
                    {needsProductLine(r, taskTypes) ? '选产品线' : '设类型'}
                  </Button>
                )}
                {['pending_assign', 'assigned', 'working'].includes(r.status) && (
                  <Button
                    type="link"
                    style={
                      isManager && r.siteId && hasTaskType(r) && r.status === 'pending_assign'
                        ? { fontWeight: 600 }
                        : undefined
                    }
                    icon={<UserAddOutlined />}
                    disabled={
                      !r.siteId || !hasTaskType(r) || needsProductLine(r, taskTypes)
                    }
                    onClick={() => {
                      const seq = ++assignLoadSeq.current;
                      assignModeTouched.current = false;
                      setAssigning(r);
                      setAssignMode(
                        r.status === 'pending_assign'
                          ? 'single'
                          : r.assignMode === 'multi'
                            ? 'multi'
                            : 'single',
                      );
                      setInspectorId(undefined);
                      setInspectorIds([]);
                      setActiveAssignees([]);
                      setPlannedUnits(
                        r.status === 'pending_assign'
                          ? 1
                          : Math.max(1, Number(r.plannedUnits) || 1),
                      );
                      setAssignReason('');
                      setInspectors(
                        r.inspectorId
                          ? [
                              {
                                id: r.inspectorId,
                                realName: r.inspectorName || '已派工程师',
                                phone: '',
                                region: '',
                                available: true,
                              },
                            ]
                          : [],
                      );
                      void Promise.all([
                        fetchFinanceInspectors(r.id),
                        fetchFinanceCase(r.id).catch(() => null),
                      ]).then(([list, detail]) => {
                        // 弹窗已换案/关闭：勿用异步结果覆盖
                        if (seq !== assignLoadSeq.current) return;
                        const assigns = (detail?.assignments || []).filter(
                          (a) => a.status !== 'withdrawn',
                        );
                        const active = assigns
                          .filter((a) => a.inspectorId)
                          .map((a) => ({
                            id: a.inspectorId!,
                            realName: a.inspectorName || a.username || a.inspectorId!,
                            completedUnits: Number(a.completedUnits || 0),
                          }));
                        setActiveAssignees(active);
                        // 仅在用户未切换模式、且仍为单人换人流程时，预填当前工程师
                        if (
                          !assignModeTouched.current &&
                          (detail?.assignMode || r.assignMode) === 'single' &&
                          active[0]
                        ) {
                          setInspectorId(active[0].id);
                          setInspectorIds([active[0].id]);
                        } else if (!assignModeTouched.current) {
                          setInspectorId(undefined);
                          setInspectorIds([]);
                        } else {
                          // 用户已切多人：清掉不在可选项里的 id，避免出现 UUID 乱码
                          setInspectorIds((prev) =>
                            prev.filter((id) => !active.some((a) => a.id === id)),
                          );
                        }
                        // 用户已手动切换模式：勿用详情把多人打回单人
                        if (!assignModeTouched.current && r.status !== 'pending_assign') {
                          if (detail?.assignMode === 'multi' || detail?.assignMode === 'single') {
                            setAssignMode(detail.assignMode);
                          }
                          if (detail?.plannedUnits) {
                            setPlannedUnits(Math.max(1, Number(detail.plannedUnits) || 1));
                          }
                        }
                        const byId = new Map(list.map((item) => [item.id, item]));
                        for (const a of active) {
                          if (byId.has(a.id)) continue;
                          byId.set(a.id, {
                            id: a.id,
                            realName: a.realName,
                            phone: '',
                            region: '',
                            available: true,
                          });
                        }
                        setInspectors([...byId.values()]);
                      });
                    }}
                  >
                    {r.status === 'pending_assign'
                      ? '派单'
                      : r.assignMode === 'multi'
                        ? '加人/撤回'
                        : '换人'}
                  </Button>
                )}
                {r.assignMode === 'multi' &&
                  ['assigned', 'working', 'finished', 'settle_review'].includes(r.status) && (
                    <Button
                      type="link"
                      onClick={() => {
                        setPlanModal(r);
                        setPlanUnits(Math.max(1, Number(r.plannedUnits) || 1));
                      }}
                    >
                      {['finished', 'settle_review'].includes(r.status) ? '增补台数' : '调台数'}
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
              );
            },
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
            ? '批量分配/改派到网格'
            : `${siteModal?.case?.siteId ? '改派网格' : '分配网格'} · ${siteModal?.case?.gspCaseNo || ''}`
        }
        okText="确认"
        cancelText="取消"
        okButtonProps={{
          disabled:
            !siteId ||
            (siteModal?.mode === 'single' &&
              !!siteModal.case?.siteId &&
              siteId === siteModal.case.siteId),
        }}
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
            const prevSiteId = siteModal.case.siteId || '';
            if (prevSiteId && prevSiteId === siteId) {
              message.info('未更换网格，无需改派');
              setSiteModal(undefined);
              return;
            }
            const wasAssigned = !!prevSiteId;
            const hadDispatch =
              siteModal.case.status !== 'pending_assign' || !!siteModal.case.inspectorId;
            await setFinanceCaseSite(siteModal.case.id, siteId);
            message.success(
              wasAssigned
                ? hadDispatch
                  ? '已改派网格，原派单已全部清空，请新网格重新派单'
                  : '已改派网格'
                : '网格已分配',
            );
          }
          setSiteModal(undefined);
          await load();
        }}
      >
        {!!siteModal?.case?.siteId && siteId && siteId !== siteModal.case.siteId && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="改派到其他网格后，原工程师派单与未提交巡检将清空，需由新网格网格长重新派单。"
          />
        )}
        {!!siteModal?.case?.siteId && siteId === siteModal.case.siteId && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="当前已是该网格。请选择其他网格后再确认改派。"
          />
        )}
        <Select
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
          value={siteId}
          placeholder="选择归属网格（对应网格长）"
          onChange={setSiteId}
          options={sitesInLocation.map((s) => ({
            value: s.id,
            label: `${s.name}（网格长：${s.manager?.realName || '未任命'}）`,
          }))}
        />
      </Modal>
      <Modal
        open={!!typeModal}
        title={`设置服务类型 · ${typeModal?.gspCaseNo || ''}`}
        okText="确认"
        cancelText="取消"
        okButtonProps={{
          disabled: (() => {
            if (!taskTemplateId || !typeModal) return true;
            const tpl = taskTypes.find((t) => t.id === taskTemplateId);
            const lines = tpl?.productLines || [];
            const prefer = String(typeModal.productLine || '').trim();
            // 案例带了产品线：未精确匹配前不允许确认（需先去服务类型新增）
            if (prefer) {
              return !lines.some((p) => String(p.name || '').trim() === prefer);
            }
            if (lines.length && !productLine) return true;
            return false;
          })(),
        }}
        onCancel={() => setTypeModal(undefined)}
        onOk={async () => {
          if (!typeModal || !taskTemplateId) return;
          const tpl = taskTypes.find((t) => t.id === taskTemplateId);
          const lines = tpl?.productLines || [];
          const prefer = String(typeModal.productLine || '').trim();
          if (prefer && !lines.some((p) => String(p.name || '').trim() === prefer)) {
            message.warning(
              `请先到「服务类型」为「${tpl?.name || ''}」新增产品线「${prefer}」，保存后再回来确认`,
            );
            return;
          }
          if (lines.length && !productLine) {
            message.warning('请选择产品线');
            return;
          }
          await setFinanceCaseTaskType(typeModal.id, taskTemplateId, productLine || prefer || undefined);
          message.success(
            productLine || prefer
              ? `已设置：${tpl?.name} / ${productLine || prefer}`
              : '服务类型已设置',
          );
          setTypeModal(undefined);
          await load();
        }}
      >
        {typeModal?.serviceType ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`案例服务类型：${typeModal.serviceType}${
              taskTypes.some((t) => t.name === String(typeModal.serviceType).trim())
                ? '（已自动匹配同名模板）'
                : '（未找到同名模板，请手动选择或先在「服务类型」新建）'
            }`}
          />
        ) : (
          <p style={{ marginBottom: 12 }}>
            从「服务类型」中选择（与 GSP 服务类型 / PO 需求类型一致）。若该类型配置了产品线，还需选择产品线。
          </p>
        )}
        <div style={{ marginBottom: 6 }}>服务类型</div>
        <Select
          style={{ width: '100%', marginBottom: 12 }}
          showSearch
          optionFilterProp="label"
          value={taskTemplateId}
          placeholder={taskTypes.length ? '选择服务类型' : '请先在「服务类型」新建'}
          onChange={(id) => {
            setTaskTemplateId(id);
            const tpl = taskTypes.find((t) => t.id === id);
            const lines = tpl?.productLines || [];
            const prefer = String(typeModal?.productLine || '').trim();
            const matched = prefer
              ? lines.find((p) => String(p.name || '').trim() === prefer)
              : undefined;
            setProductLine(matched?.name || (lines.length === 1 ? lines[0].name : undefined));
          }}
          options={[...taskTypes]
            .sort((a, b) => {
              const demand = String(typeModal?.serviceType || '').trim();
              if (!demand) return 0;
              const score = (t: TemplateItem) => (t.name === demand ? 0 : 1);
              return score(a) - score(b);
            })
            .map((t) => ({
              value: t.id,
              label: `${t.name}${
                t.productLines?.length
                  ? `（${t.productLines.length} 条产品线）`
                  : `（${t.entries?.length || 0} 项）`
              }`,
            }))}
        />
        {(() => {
          const tpl = taskTypes.find((t) => t.id === taskTemplateId);
          const lines = tpl?.productLines || [];
          const prefer = String(typeModal?.productLine || '').trim();
          const matched = prefer
            ? lines.find((p) => String(p.name || '').trim() === prefer)
            : undefined;
          // 案例带来产品线，但模板未配/未命中：必须提示去服务类型新增
          if (prefer && !matched) {
            return (
              <>
                <div style={{ marginBottom: 6 }}>产品线</div>
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={`案例产品线「${prefer}」尚未在「${tpl?.name || '该服务类型'}」中配置`}
                  description={
                    lines.length
                      ? '请先到左侧菜单「服务类型」中新增同名产品线并配置检查条目，保存后回到此处即可精确匹配。'
                      : '当前服务类型还没有任何产品线（仅有通用检查项）。请先到「服务类型」为该类型新增产品线（名称须与案例完全一致，如：地面-组串式），保存后会自动识别。'
                  }
                />
                {lines.length ? (
                  <Select
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                    value={productLine}
                    placeholder="若已临时选其他已配置产品线可在此选择"
                    onChange={setProductLine}
                    options={lines.map((p) => ({
                      value: p.name,
                      label: `${p.name}（${p.entries?.length || 0} 项）`,
                    }))}
                  />
                ) : null}
              </>
            );
          }
          if (!lines.length) return null;
          return (
            <>
              <div style={{ marginBottom: 6 }}>产品线</div>
              {prefer ? (
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={`案例产品线已精确匹配：${prefer}`}
                />
              ) : null}
              <Select
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="label"
                value={productLine}
                placeholder="选择产品线（组串 / 集中 / 充电…）"
                onChange={setProductLine}
                options={lines.map((p) => ({
                  value: p.name,
                  label: `${p.name}（${p.entries?.length || 0} 项）`,
                }))}
              />
            </>
          );
        })()}
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
            message.warning('请指定本网格工程师');
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
          message={`已选 ${selectedCases.length} 个案例（须同一网格、已设服务类型、待派单）`}
        />
        <div>
          <div style={{ marginBottom: 6 }}>本网格工程师</div>
          <Select
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            value={batchInspectorId}
            placeholder="选择工程师"
            onChange={setBatchInspectorId}
            options={siteMembers.map((m) => ({
              value: m.userId,
              label: inspectorOptionLabel({
                realName: m.user?.realName,
                username: m.user?.username,
                phone: m.user?.phone,
              }),
            }))}
          />
        </div>
      </Modal>
      <Modal
        open={!!assigning}
        title={`${
          !assigning
            ? '派单'
            : assigning.status === 'pending_assign'
              ? '派本网格工程师'
              : assignMode === 'multi'
                ? '加人 / 撤回工程师'
                : '换人'
        } · ${assigning?.gspCaseNo || ''}`}
        okText={(() => {
          if (assigning?.status === 'pending_assign') return '确认派单';
          if (assignMode !== 'multi') return '确认换人';
          const adding = inspectorIds.filter(
            (id) => !activeAssignees.some((a) => a.id === id),
          );
          const convertingFromSingle = (assigning?.assignMode || 'single') !== 'multi';
          if (convertingFromSingle) return adding.length || activeAssignees.length ? '确认改多人' : '确认';
          // 已是多人：撤回已即时生效；有新人则确认加人，否则点完成关闭
          return adding.length ? '确认加人' : '完成';
        })()}
        cancelText="取消"
        okButtonProps={{
          disabled: (() => {
            if (assignMode === 'multi') {
              if (assigning?.status === 'pending_assign') {
                return inspectorIds.length === 0;
              }
              const adding = inspectorIds.filter(
                (id) => !activeAssignees.some((a) => a.id === id),
              );
              const convertingFromSingle =
                (assigning?.assignMode || 'single') !== 'multi';
              // 单人改多人：至少保留/选一人；已是多人：可不加人，直接「完成」（撤回已即时生效）
              if (convertingFromSingle) {
                return activeAssignees.length === 0 && adding.length === 0;
              }
              return false;
            }
            return !inspectorId;
          })(),
        }}
        onCancel={() => {
          assignLoadSeq.current += 1;
          setAssigning(undefined);
          setActiveAssignees([]);
          void load();
        }}
        onOk={async () => {
          if (!assigning) return;
          const multi = assignMode === 'multi';
          const isFirst = assigning.status === 'pending_assign';
          if (multi) {
            const existingIds = activeAssignees.map((a) => a.id);
            const existing = new Set(existingIds);
            const convertingFromSingle =
              !isFirst && (assigning.assignMode || 'single') !== 'multi';
            const added = inspectorIds.filter(
              (id) => !existing.has(id) && !activeAssignees.some((a) => a.id === id),
            );
            // 已是多人且未选新人：撤回已即时生效，这里只关窗并刷新（顺带可保存台数）
            if (!isFirst && !convertingFromSingle && !added.length) {
              const nextPlan = Math.max(1, plannedUnits || 1);
              if (nextPlan !== Math.max(1, Number(assigning.plannedUnits) || 1)) {
                await setFinanceCaseWorkPlan(assigning.id, { plannedUnits: nextPlan });
                message.success('计划台数已更新');
              } else {
                message.success('已更新派单人员');
              }
              setAssigning(undefined);
              setActiveAssignees([]);
              await load();
              return;
            }
            // 首次派单：用所选；单人改多人：本地保留的原人 + 新人；多人加人：仅新人
            const toSend = isFirst
              ? inspectorIds
              : convertingFromSingle
                ? [...new Set([...existingIds, ...added])]
                : added;
            if (!toSend.length) {
              message.warning(
                isFirst
                  ? '请选择工程师'
                  : convertingFromSingle
                    ? '请选择要派的工程师（可先撤回不想保留的原工程师）'
                    : '请选择要追加的工程师',
              );
              return;
            }
            // 单人改多人且本地已撤回部分原人：记下待服务端撤回的人
            const serverActiveIds = convertingFromSingle
              ? (
                  await fetchFinanceCase(assigning.id).catch(() => null)
                )?.assignments
                  ?.filter((a) => a.status !== 'withdrawn' && a.inspectorId)
                  .map((a) => a.inspectorId!) || existingIds
              : [];
            const toWithdraw = convertingFromSingle
              ? serverActiveIds.filter((id) => !toSend.includes(id))
              : [];

            await assignFinanceCase(assigning.id, toSend, assignReason || undefined, {
              assignMode: 'multi',
              plannedUnits: Math.max(1, plannedUnits || 1),
            });
            for (const wid of toWithdraw) {
              try {
                await withdrawFinanceAssignee(assigning.id, wid);
              } catch {
                /* 已无进度则可撤；失败不阻断主流程 */
              }
            }
            message.success(
              isFirst
                ? `已派给 ${toSend.length} 名工程师`
                : convertingFromSingle
                  ? toWithdraw.length
                    ? `已改为多人模式，并完成换人`
                    : added.length
                      ? `已改为多人模式，并追加 ${added.length} 名工程师`
                      : '已改为多人模式'
                  : `已追加 ${toSend.length} 名工程师`,
            );
          } else {
            if (!inspectorId) return;
            await assignFinanceCase(assigning.id, inspectorId, assignReason || undefined, {
              assignMode: 'single',
              plannedUnits: 1,
            });
            message.success(
              isFirst ? '派单成功，工程师可在手机端接单作业' : '已换人，原工程师派单已撤回',
            );
          }
          setAssigning(undefined);
          setActiveAssignees([]);
          await load();
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>派单模式</div>
          <Select
            style={{ width: '100%' }}
            value={assignMode}
            disabled={
              // 已是多人且有在派人：锁定为多人（加人/撤回）；单人已派允许改多人
              assigning?.status !== 'pending_assign' &&
              (assigning?.assignMode || 'single') === 'multi' &&
              activeAssignees.length > 0
            }
            onChange={(v: 'single' | 'multi') => {
              assignModeTouched.current = true;
              setAssignMode(v);
              if (v === 'single') {
                setInspectorIds(inspectorId ? [inspectorId] : []);
                setPlannedUnits(1);
              } else if (
                assigning?.status !== 'pending_assign' &&
                (assigning?.assignMode || 'single') === 'single'
              ) {
                // 单人改多人：预填台数，保留当前在派人
                setPlannedUnits((n) => Math.max(n || 1, activeAssignees.length || 1, 2));
                setInspectorIds([]);
              }
            }}
            options={[
              { value: 'single', label: '单人模式（1 人负责）' },
              { value: 'multi', label: '多人模式（可设台数、加人）' },
            ]}
          />
          {assigning?.status === 'pending_assign' ? (
            <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 12 }}>
              默认单人；需要多人作业时在此切换，并自行填写计划台数。
            </div>
          ) : (assigning?.assignMode || 'single') === 'single' && assignMode === 'multi' ? (
            <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 12 }}>
              改为多人后可设台数；不想保留原工程师请先点「撤回」，再选其他人确认。
            </div>
          ) : (assigning?.assignMode || 'single') === 'single' ? (
            <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 12 }}>
              可改为多人模式：设置计划台数后确认即可；也可顺带追加工程师，原工程师保留。
            </div>
          ) : null}
        </div>
        {assignMode === 'multi' ? (
          <>
            {activeAssignees.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6 }}>当前在派</div>
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {activeAssignees.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        background: '#f5faf7',
                        borderRadius: 8,
                      }}
                    >
                      <span>
                        {a.realName}
                        <Tag style={{ marginLeft: 8 }}>
                          完成 {Number(a.completedUnits || 0)} 台
                        </Tag>
                      </span>
                      <Button
                        type="link"
                        danger
                        size="small"
                        disabled={Number(a.completedUnits || 0) > 0}
                        onClick={async () => {
                          if (!assigning) return;
                          const next = activeAssignees.filter((x) => x.id !== a.id);
                          // 案例仍是单人、弹窗里刚切多人：仅本地移除，确认时再生效
                          if ((assigning.assignMode || 'single') === 'single') {
                            setActiveAssignees(next);
                            setInspectorIds((ids) => ids.filter((id) => id !== a.id));
                            message.success(
                              `已去掉 ${a.realName}，请选择其他人后点确认`,
                            );
                            return;
                          }
                          try {
                            await withdrawFinanceAssignee(assigning.id, a.id);
                            message.success(`已撤回 ${a.realName}`);
                            setActiveAssignees(next);
                            setInspectorIds((ids) => ids.filter((id) => id !== a.id));
                            await load();
                            // 撤光后保持弹窗，便于立刻改派新人
                            if (!next.length) {
                              setAssigning({
                                ...assigning,
                                status: 'pending_assign',
                                assignMode: 'multi',
                                inspectorId: undefined,
                                inspectorName: undefined,
                              });
                            }
                          } catch (err: unknown) {
                            const msg =
                              (err as { response?: { data?: { message?: string } } })?.response
                                ?.data?.message || '撤回失败';
                            message.error(String(msg));
                          }
                        }}
                      >
                        撤回
                      </Button>
                    </div>
                  ))}
                </Space>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 8 }}
                  message="「撤回」点一下立即生效，用来减少人员；下方加人后点「确认加人」。若不加人，点「完成」关闭即可。"
                />
              </div>
            )}
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={
                (assigning?.assignMode || 'single') !== 'multi' && activeAssignees.length > 0
                  ? '正在改为多人模式：默认保留原工程师。若要换成别人，先点「撤回」再选择新人。'
                  : activeAssignees.length
                    ? '减少人：点「撤回」立即生效。增加人：下方选择后点「确认加人」。'
                    : '请选择工程师（可多选），确认后生效。'
              }
            />
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 6 }}>
                计划台数（作业台，不是人数）
                <span style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 12 }}>
                  当前在派 {activeAssignees.length} 人
                </span>
              </div>
              <Input
                type="number"
                min={1}
                value={plannedUnits}
                onChange={(e) => setPlannedUnits(Number(e.target.value) || 1)}
              />
              {activeAssignees.length > Math.max(1, plannedUnits || 1) ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8 }}
                  message={`在派 ${activeAssignees.length} 人已多于计划 ${Math.max(1, plannedUnits || 1)} 台。改台数不会自动减人，请点「撤回」减少工程师。`}
                />
              ) : null}
            </div>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              value={inspectorIds.filter(
                (id) => !activeAssignees.some((a) => a.id === id),
              )}
              placeholder={activeAssignees.length ? '选择要追加的工程师' : '选择工程师（可多选）'}
              onChange={(ids) =>
                setInspectorIds(
                  ids.filter((id) => !activeAssignees.some((a) => a.id === id)),
                )
              }
              options={inspectors
                .filter((item) => !activeAssignees.some((a) => a.id === item.id))
                .map((item) => ({
                  value: item.id,
                  label: inspectorOptionLabel(item),
                }))}
            />
          </>
        ) : (
          <>
            {assigning && assigning.status !== 'pending_assign' ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="单人换人：原工程师将被撤回；未提交的认领台会释放回可认领。报告已交或已有完成台则不能换。"
              />
            ) : (
              <p>仅显示该网格已入职工程师；同一工程师可同时负责多个案例。</p>
            )}
            <Select
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              value={inspectorId}
              placeholder="选择工程师"
              onChange={(v) => {
                setInspectorId(v);
                setInspectorIds(v ? [v] : []);
              }}
              options={inspectors.map((item) => ({
                value: item.id,
                label: inspectorOptionLabel(item),
              }))}
            />
          </>
        )}
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
      <Modal
        open={!!planModal}
        title={`${
          planModal && ['finished', 'settle_review'].includes(planModal.status)
            ? '增补台数'
            : '调整计划台数'
        } · ${planModal?.gspCaseNo || ''}`}
        okText="确认"
        cancelText="取消"
        onCancel={() => setPlanModal(undefined)}
        onOk={async () => {
          if (!planModal) return;
          const n = Math.floor(Number(planUnits) || 0);
          const completed = Number(planModal.completedUnits) || 0;
          const current = Number(planModal.plannedUnits) || 1;
          const closed = ['finished', 'settle_review'].includes(planModal.status);
          if (n < 1 || n > 500) {
            message.warning('计划台数须在 1～500');
            return;
          }
          if (n < completed) {
            message.warning(`不能少于已完成数（${completed}）`);
            return;
          }
          if (closed && n <= current) {
            message.warning('完工后只能增补，新台数须大于当前计划');
            return;
          }
          await setFinanceCaseWorkPlan(planModal.id, { plannedUnits: n });
          message.success(
            closed
              ? `已增补至 ${n} 台，案例已重开为作业中，工程师可继续认领`
              : `计划台数已更新为 ${n}`,
          );
          setPlanModal(undefined);
          await load();
        }}
      >
        {planModal && ['finished', 'settle_review'].includes(planModal.status) ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="案例已完工。增补后将重开为「作业中」，已完成报告保留；工程师继续认领新增单元，全部完成后再自动结案。"
          />
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="增加会追加可认领单元；减少只能去掉末尾仍「可认领」的单元，且不能少于已完成数。"
          />
        )}
        <div style={{ marginBottom: 8, color: '#666' }}>
          当前进度：{planModal?.completedUnits || 0} / {planModal?.plannedUnits || 1}{' '}
          {planModal?.unitLabel || '台'}
          {planModal?.status
            ? ` · ${dispatchStatusLabel[planModal.status] || planModal.status}`
            : ''}
        </div>
        <div style={{ marginBottom: 6 }}>新的计划台数</div>
        <Input
          type="number"
          min={1}
          max={500}
          value={planUnits}
          onChange={(e) => setPlanUnits(Number(e.target.value) || 1)}
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
                {
                  key: 'serviceType',
                  label: '服务类型',
                  children: displayTaskType(detail) || detail.serviceType || '-',
                },
                {
                  key: 'productLine',
                  label: '产品线',
                  children: detail.productLine || '-',
                },
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
                  label: '归属网格',
                  children: detail.siteName
                    ? `${detail.siteName}${detail.siteManagerName ? `（网格长：${detail.siteManagerName}）` : ''}`
                    : detail.siteId || '-',
                },
                {
                  key: 'inspector',
                  label: '工程师',
                  children: (() => {
                    const fromAssign = (detail.assignments || [])
                      .filter((a: { status?: string }) => a.status !== 'withdrawn')
                      .map((a: { inspectorName?: string }) => a.inspectorName)
                      .filter(Boolean);
                    const names = fromAssign.length
                      ? fromAssign
                      : String(detail.inspectorName || '')
                          .split(/[、,，]/)
                          .map((s: string) => s.trim())
                          .filter(Boolean);
                    if (!names.length) return detail.inspectorId || '-';
                    return `${names.join('、')}（${names.length}人）`;
                  })(),
                },
                {
                  key: 'status',
                  label: '派单状态',
                  children: dispatchStatus(detail as FinanceCase).text,
                },
                {
                  key: 'crew',
                  label: '在派/计划',
                  children: (() => {
                    const names = (detail.assignments || [])
                      .filter((a: { status?: string }) => a.status !== 'withdrawn')
                      .map((a: { inspectorName?: string }) => a.inspectorName)
                      .filter(Boolean);
                    const people =
                      names.length ||
                      (String(detail.inspectorName || '')
                        .split(/[、,，]/)
                        .map((s: string) => s.trim())
                        .filter(Boolean).length
                        ? String(detail.inspectorName || '')
                            .split(/[、,，]/)
                            .map((s: string) => s.trim())
                            .filter(Boolean).length
                        : detail.inspectorId
                          ? 1
                          : 0);
                    const plan = Math.max(1, Number(detail.plannedUnits) || 1);
                    return `${people} 人 / ${plan} 台`;
                  })(),
                },
                {
                  key: 'revenue',
                  label: '案例收入',
                  children: `¥ ${Number(detail.caseRevenue || 0).toFixed(2)}`,
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
