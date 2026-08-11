import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Tabs,
  Tooltip,
  message,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  LinkOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  clearPoOrders,
  downloadFinanceImportTemplate,
  exportPoOrders,
  fetchPoOrders,
  generateCasesFromPo,
  matchPoOrder,
  updatePoOrder,
} from '../../../api/finance';
import type { PoItemRow, PoOrder, UpdatePoItemPayload } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';
import ImportDialog from '../components/ImportDialog';
import { canUseDangerousClear, confirmDangerousClear } from '../../../utils/finance-clear';

const itemColumns = [
  { title: '服务条目', dataIndex: 'itemName', ellipsis: { showTitle: false }, render: ellipsisCell },
  {
    title: '条目说明',
    dataIndex: 'itemDesc',
    width: 160,
    ellipsis: { showTitle: false },
    render: (v: string | null | undefined) => ellipsisCell(v || '-'),
  },
  { title: '单位', dataIndex: 'unit', width: 70, render: (v: string | null | undefined) => v || '-' },
  {
    title: '数量',
    dataIndex: 'qty',
    width: 80,
    render: (v: string | number) => Number(v).toFixed(2),
  },
];

function ellipsisCell(v: string | null | undefined) {
  const text = v == null || v === '' ? '-' : String(v);
  return (
    <Tooltip title={text === '-' ? undefined : text} placement="topLeft">
      <span>{text}</span>
    </Tooltip>
  );
}

function dash(v: string | number | null | undefined) {
  if (v == null || v === '') return '-';
  return String(v);
}

function itemsOf(order: PoOrder, category: 'special' | 'general'): PoItemRow[] {
  return (order.items || []).filter((item) => item.itemCategory === category);
}

function displayProjectName(order: PoOrder) {
  if (order.matchStatus === 'matched' && order.linkedCase?.projectName) {
    return order.linkedCase.projectName;
  }
  return order.projectName || '-';
}

export default function PoOrdersPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const admin = user?.role === 'super_admin';
  const canClear = admin && canUseDangerousClear();
  const [status, setStatus] = useState<'matched' | 'pending'>('matched');
  const [data, setData] = useState<PoOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [match, setMatch] = useState<PoOrder>();
  const [edit, setEdit] = useState<PoOrder>();
  const [editSaving, setEditSaving] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  useEffect(() => {
    if (!admin && status === 'pending') setStatus('matched');
  }, [admin, status]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchPoOrders({
        page,
        limit: 10,
        matchStatus: status,
        keyword: keyword || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setData(r.list);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, status, keyword, dateFrom, dateTo]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSelectedRowKeys([]);
  }, [status, keyword, dateFrom, dateTo, page]);
  const openEdit = (order: PoOrder) => {
    setEdit(order);
    editForm.setFieldsValue({
      poTotalAmount: Number(order.poTotalAmount || 0),
      productModel: order.productModel || '',
      productQty:
        order.productQty == null || order.productQty === '' ? undefined : Number(order.productQty),
      projectScene: order.projectScene || '',
      specialItems: itemsOf(order, 'special').map((item) => ({
        itemName: item.itemName,
        itemDesc: item.itemDesc || '',
        unit: item.unit || '',
        qty: Number(item.qty),
      })),
      generalItems: itemsOf(order, 'general').map((item) => ({
        itemName: item.itemName,
        itemDesc: item.itemDesc || '',
        unit: item.unit || '',
        qty: Number(item.qty),
      })),
    });
  };
  const submitMatch = async () => {
    const v = await form.validateFields();
    await matchPoOrder(match!.id, v.gspCaseNo);
    message.success('PO已挂接案例');
    setMatch(undefined);
    form.resetFields();
    void load();
  };
  const submitEdit = async () => {
    if (!edit) return;
    const values = await editForm.validateFields();
    const special: UpdatePoItemPayload[] = (values.specialItems || [])
      .filter((row: { itemName?: string }) => String(row.itemName || '').trim())
      .map((row: { itemName: string; itemDesc?: string; unit?: string; qty: number }) => ({
        itemCategory: 'special' as const,
        itemName: String(row.itemName).trim(),
        itemDesc: row.itemDesc ? String(row.itemDesc).trim() : null,
        unit: row.unit ? String(row.unit).trim() : null,
        qty: Number(row.qty),
      }));
    const general: UpdatePoItemPayload[] = (values.generalItems || [])
      .filter((row: { itemName?: string }) => String(row.itemName || '').trim())
      .map((row: { itemName: string; itemDesc?: string; unit?: string; qty: number }) => ({
        itemCategory: 'general' as const,
        itemName: String(row.itemName).trim(),
        itemDesc: row.itemDesc ? String(row.itemDesc).trim() : null,
        unit: row.unit ? String(row.unit).trim() : null,
        qty: Number(row.qty),
      }));
    setEditSaving(true);
    try {
      await updatePoOrder(edit.id, {
        poTotalAmount: Number(values.poTotalAmount),
        productModel: values.productModel ? String(values.productModel).trim() : null,
        productQty:
          values.productQty === undefined || values.productQty === null
            ? null
            : Number(values.productQty),
        projectScene: values.projectScene ? String(values.projectScene).trim() : null,
        items: [...special, ...general],
      });
      message.success('PO 已保存并重新计价');
      setEdit(undefined);
      editForm.resetFields();
      void load();
    } finally {
      setEditSaving(false);
    }
  };
  const generateCases = () => {
    Modal.confirm({
      title: '应急：从待匹配 PO 补建案例',
      content:
        '正常流程应先导入 GSP 再建案例。本操作仅用于历史漏导 GSP 时兜底：按 PO 的 GSP 案例号补建案例（状态「待结算审核」）并自动挂接。已有案例不会重复创建。',
      okText: '开始补建',
      cancelText: '取消',
      onOk: async () => {
        setGenerating(true);
        try {
          const result = await generateCasesFromPo();
          message.success(
            `补建案例 ${result.generatedCases} 个，成功匹配 PO ${result.matchedOrders} 个`,
          );
          setStatus('matched');
          setPage(1);
          void load();
        } finally {
          setGenerating(false);
        }
      },
    });
  };
  const onClear = async () => {
    const ok = await confirmDangerousClear({
      title: '清空全部 PO？',
      description: '将删除全部 PO 订单及其明细。案例本身不会删除。',
    });
    if (!ok) return;
    setClearing(true);
    try {
      const result = await clearPoOrders();
      message.success(`已清空 ${result.deleted} 条 PO`);
      setPage(1);
      await load();
    } finally {
      setClearing(false);
    }
  };
  const renderItemEditor = (name: 'specialItems' | 'generalItems', title: string) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 8, fontWeight: 600 }}>{title}</div>
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <>
            {fields.map((field) => (
              <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
                <Form.Item
                  {...field}
                  name={[field.name, 'itemName']}
                  rules={[{ required: true, message: '条目名' }]}
                  style={{ marginBottom: 0, width: 200 }}
                >
                  <Input placeholder="服务条目" />
                </Form.Item>
                <Form.Item {...field} name={[field.name, 'itemDesc']} style={{ marginBottom: 0, width: 160 }}>
                  <Input placeholder="说明" />
                </Form.Item>
                <Form.Item {...field} name={[field.name, 'unit']} style={{ marginBottom: 0, width: 80 }}>
                  <Input placeholder="单位" />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, 'qty']}
                  rules={[{ required: true, message: '数量' }]}
                  style={{ marginBottom: 0, width: 100 }}
                >
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="数量" />
                </Form.Item>
                <MinusCircleOutlined onClick={() => remove(field.name)} />
              </Space>
            ))}
            <Button type="dashed" onClick={() => add({ qty: 1 })} block icon={<PlusOutlined />}>
              添加{title}
            </Button>
          </>
        )}
      </Form.List>
    </div>
  );
  return (
    <Card className="finance-card">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={admin ? '第二次导入：钉钉 PO 表（单文件）' : '本网格已匹配 PO'}
        description={
          admin
            ? '从钉钉导出的一张 PO Excel 即可。按 GSP 案例号挂接案例。已匹配时项目名称等主数据以案例为准（只读）；「编辑」仅改本 PO 的金额、型号、场景与条目，保存后自动重计价。故障说明等钉钉原文请重新导入更新。'
            : '仅显示已挂接到本网格案例的 PO。未匹配、未分配网格的 PO 由管理员处理。'
        }
      />
      {admin && (
        <div className="finance-toolbar">
          <Input.Search
            allowClear
            placeholder="PO单号/案例号/项目名"
            style={{ width: 220 }}
            onSearch={(v) => {
              setPage(1);
              setKeyword(v);
            }}
          />
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
            title="起始日期（需求日/创建）"
            style={{ width: 150 }}
          />
          <span style={{ color: '#888' }}>至</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
            title="结束日期（需求日/创建）"
            style={{ width: 150 }}
          />
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={() => {
              void (async () => {
                setExporting(true);
                try {
                  const ids = selectedRowKeys.map(String);
                  await exportPoOrders(
                    ids.length
                      ? { ids }
                      : {
                          matchStatus: status,
                          keyword: keyword || undefined,
                          dateFrom: dateFrom || undefined,
                          dateTo: dateTo || undefined,
                        },
                  );
                  message.success(ids.length ? `已导出勾选 ${ids.length} 条` : '已按当前筛选导出');
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '导出失败');
                } finally {
                  setExporting(false);
                }
              })();
            }}
          >
            {selectedRowKeys.length ? `导出勾选 (${selectedRowKeys.length})` : '导出 Excel'}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              void downloadFinanceImportTemplate('po').catch(() => undefined);
            }}
          >
            下载模板
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={() => setImportOpen(true)}>
            导入 PO
          </Button>
          <Button icon={<SyncOutlined />} loading={generating} onClick={generateCases}>
            应急：从 PO 补建案例
          </Button>
          {canClear && (
            <Button danger icon={<DeleteOutlined />} loading={clearing} onClick={() => void onClear()}>
              清空全部 PO
            </Button>
          )}
        </div>
      )}
      <Tabs
        activeKey={status}
        onChange={(v) => {
          setPage(1);
          setStatus(v as 'matched' | 'pending');
        }}
        items={
          admin
            ? [
                { key: 'matched', label: '已匹配' },
                { key: 'pending', label: '待匹配队列' },
              ]
            : [{ key: 'matched', label: '本网格已匹配 PO' }]
        }
      />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        rowSelection={
          admin
            ? {
                selectedRowKeys,
                onChange: setSelectedRowKeys,
              }
            : undefined
        }
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        scroll={{ x: 1600 }}
        expandable={{
          expandedRowRender: (r) => {
            const special = itemsOf(r, 'special');
            const general = itemsOf(r, 'general');
            const linked = r.linkedCase;
            return (
              <div style={{ display: 'grid', gap: 12 }}>
                {linked && (
                  <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3 }} title="关联案例（只读）">
                    <Descriptions.Item label="GSP案例号">{linked.gspCaseNo}</Descriptions.Item>
                    <Descriptions.Item label="项目名称">{dash(linked.projectName)}</Descriptions.Item>
                    <Descriptions.Item label="服务类型">{dash(linked.serviceType)}</Descriptions.Item>
                    <Descriptions.Item label="产品线">{dash(linked.productLine)}</Descriptions.Item>
                    <Descriptions.Item label="省份">{dash(linked.province)}</Descriptions.Item>
                    <Descriptions.Item label="城市">{dash(linked.city)}</Descriptions.Item>
                    <Descriptions.Item label="站点描述" span={3}>
                      {dash(linked.siteDesc)}
                    </Descriptions.Item>
                  </Descriptions>
                )}
                <Descriptions
                  size="small"
                  bordered
                  column={{ xs: 1, sm: 2, md: 3 }}
                  title="PO 导入快照（钉钉原文）"
                >
                  <Descriptions.Item label="需求日期">{dash(r.demandDate)}</Descriptions.Item>
                  <Descriptions.Item label="需求人">{dash(r.demander)}</Descriptions.Item>
                  <Descriptions.Item label="需求类型">{dash(r.demandType)}</Descriptions.Item>
                  <Descriptions.Item label="产品线">{dash(r.productLine)}</Descriptions.Item>
                  <Descriptions.Item label="产品型号">{dash(r.productModel)}</Descriptions.Item>
                  <Descriptions.Item label="产品台数">
                    {r.productQty == null || r.productQty === '' ? '-' : Number(r.productQty)}
                  </Descriptions.Item>
                  <Descriptions.Item label="故障等级">{dash(r.faultLevel)}</Descriptions.Item>
                  <Descriptions.Item label="工期要求">{dash(r.durationReq)}</Descriptions.Item>
                  <Descriptions.Item label="项目场景">{dash(r.projectScene)}</Descriptions.Item>
                  <Descriptions.Item label="项目大区">{dash(r.projectArea)}</Descriptions.Item>
                  <Descriptions.Item label="项目国家">{dash(r.projectCountry)}</Descriptions.Item>
                  <Descriptions.Item label="项目区域">{dash(r.projectRegion)}</Descriptions.Item>
                  <Descriptions.Item label="项目省份">{dash(r.province)}</Descriptions.Item>
                  <Descriptions.Item label="提交人">{dash(r.submitter)}</Descriptions.Item>
                  <Descriptions.Item label="项目名称" span={3}>
                    {dash(r.projectName)}
                  </Descriptions.Item>
                  <Descriptions.Item label="故障现象" span={3}>
                    {dash(r.faultPhenomenon)}
                  </Descriptions.Item>
                  <Descriptions.Item label="需求描述" span={3}>
                    {dash(r.demandDesc)}
                  </Descriptions.Item>
                </Descriptions>
                <div>
                  <div style={{ marginBottom: 6, fontWeight: 600 }}>
                    专用服务条目（{special.length}）
                  </div>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={special}
                    columns={itemColumns}
                    locale={{ emptyText: '无专用条目' }}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 6, fontWeight: 600 }}>
                    通用服务条目（{general.length}）
                  </div>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={general}
                    columns={itemColumns}
                    locale={{ emptyText: '无通用条目' }}
                  />
                </div>
              </div>
            );
          },
        }}
        columns={[
          { title: 'PO单号', dataIndex: 'poNo', width: 150, fixed: 'left' },
          { title: 'GSP案例号', dataIndex: 'gspCaseNo', width: 140 },
          {
            title: 'PO总金额',
            dataIndex: 'poTotalAmount',
            width: 120,
            render: (v) => <span className="finance-money">¥ {Number(v).toFixed(2)}</span>,
          },
          {
            title: '产品型号',
            dataIndex: 'productModel',
            width: 140,
            ellipsis: { showTitle: false },
            render: (v) => ellipsisCell(v || '-'),
          },
          {
            title: '产品台数',
            dataIndex: 'productQty',
            width: 90,
            render: (v) => (v == null || v === '' ? '-' : Number(v)),
          },
          {
            title: '故障等级',
            dataIndex: 'faultLevel',
            width: 90,
            render: (v) => v || '-',
          },
          {
            title: '工期要求',
            dataIndex: 'durationReq',
            width: 100,
            ellipsis: { showTitle: false },
            render: (v) => ellipsisCell(v || '-'),
          },
          {
            title: '项目名称',
            key: 'displayProjectName',
            width: 240,
            ellipsis: { showTitle: false },
            render: (_, r) => ellipsisCell(displayProjectName(r)),
          },
          {
            title: '项目场景',
            dataIndex: 'projectScene',
            width: 90,
            render: (v) => v || '-',
          },
          {
            title: '专用条目',
            width: 90,
            render: (_, r) => r.specialItemCount ?? itemsOf(r, 'special').length,
          },
          {
            title: '通用条目',
            width: 90,
            render: (_, r) => r.generalItemCount ?? itemsOf(r, 'general').length,
          },
          {
            title: '匹配状态',
            dataIndex: 'matchStatus',
            width: 100,
            render: (v) => (
              <Tag color={v === 'matched' ? 'success' : 'warning'}>
                {v === 'matched' ? '已匹配' : '待匹配'}
              </Tag>
            ),
          },
          {
            title: '操作',
            width: 160,
            fixed: 'right',
            render: (_, r) => (
              <Space size={0}>
                {admin && (
                  <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                )}
                {r.matchStatus === 'pending' ? (
                  <Button type="link" icon={<LinkOutlined />} onClick={() => setMatch(r)}>
                    人工挂接
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      <ImportDialog
        open={importOpen}
        kind="po"
        title="导入钉钉 PO 表单"
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          void load();
        }}
      />
      <Modal
        open={!!match}
        title={`挂接 ${match?.poNo || ''}`}
        onCancel={() => setMatch(undefined)}
        onOk={() => void submitMatch()}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="gspCaseNo"
            label="目标 GSP 案例号"
            rules={[{ required: true, message: '请输入案例号' }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        width={720}
        open={!!edit}
        title={`编辑 PO · ${edit?.poNo || ''}`}
        onClose={() => {
          if (editSaving) return;
          setEdit(undefined);
          editForm.resetFields();
        }}
        destroyOnClose
        extra={
          <Space>
            <Button
              onClick={() => {
                if (editSaving) return;
                setEdit(undefined);
                editForm.resetFields();
              }}
            >
              取消
            </Button>
            <Button type="primary" loading={editSaving} onClick={() => void submitEdit()}>
              保存并重计价
            </Button>
          </Space>
        }
      >
        {edit && (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="仅编辑本 PO 商务增量"
              description="修改金额、型号、场景或条目后会重新匹配价格库并汇总到关联案例。已审核金额可能变化。"
            />
            {edit.linkedCase ? (
              <Descriptions
                size="small"
                bordered
                column={2}
                style={{ marginBottom: 16 }}
                title="关联案例（只读，请到案例管理修改）"
                extra={
                  <Button
                    type="link"
                    onClick={() =>
                      navigate(
                        `/finance/cases?keyword=${encodeURIComponent(edit.linkedCase!.gspCaseNo)}`,
                      )
                    }
                  >
                    去编辑案例
                  </Button>
                }
              >
                <Descriptions.Item label="GSP案例号">{edit.linkedCase.gspCaseNo}</Descriptions.Item>
                <Descriptions.Item label="项目名称">
                  {dash(edit.linkedCase.projectName)}
                </Descriptions.Item>
                <Descriptions.Item label="服务类型">
                  {dash(edit.linkedCase.serviceType)}
                </Descriptions.Item>
                <Descriptions.Item label="产品线">
                  {dash(edit.linkedCase.productLine)}
                </Descriptions.Item>
                <Descriptions.Item label="省份">{dash(edit.linkedCase.province)}</Descriptions.Item>
                <Descriptions.Item label="城市">{dash(edit.linkedCase.city)}</Descriptions.Item>
              </Descriptions>
            ) : (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="尚未匹配案例"
                description="主数据仍以本 PO 导入快照为准；挂接后列表项目名称将优先显示案例名称。"
              />
            )}
            <Form form={editForm} layout="vertical">
              <Form.Item
                name="poTotalAmount"
                label="PO总金额"
                rules={[{ required: true, message: '请输入金额' }]}
              >
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="productModel" label="产品型号">
                <Input maxLength={64} />
              </Form.Item>
              <Form.Item name="productQty" label="产品台数">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="projectScene" label="项目场景">
                <Input maxLength={32} />
              </Form.Item>
              {renderItemEditor('specialItems', '专用服务条目')}
              {renderItemEditor('generalItems', '通用服务条目')}
            </Form>
          </>
        )}
      </Drawer>
    </Card>
  );
}
