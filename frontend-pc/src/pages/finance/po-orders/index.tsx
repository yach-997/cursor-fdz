import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Table, Tag, Tabs, message } from 'antd';
import { DeleteOutlined, DownloadOutlined, LinkOutlined, SyncOutlined } from '@ant-design/icons';
import {
  clearPoOrders,
  downloadFinanceImportTemplate,
  fetchPoOrders,
  generateCasesFromPo,
  matchPoOrder,
} from '../../../api/finance';
import type { PoItemRow, PoOrder } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';
import ImportDialog from '../components/ImportDialog';
import { canUseDangerousClear, confirmDangerousClear } from '../../../utils/finance-clear';

const itemColumns = [
  { title: '服务条目', dataIndex: 'itemName', ellipsis: true },
  {
    title: '条目说明',
    dataIndex: 'itemDesc',
    width: 160,
    ellipsis: true,
    render: (v: string | null | undefined) => v || '-',
  },
  { title: '单位', dataIndex: 'unit', width: 70, render: (v: string | null | undefined) => v || '-' },
  {
    title: '数量',
    dataIndex: 'qty',
    width: 80,
    render: (v: string | number) => Number(v).toFixed(2),
  },
];

function itemsOf(order: PoOrder, category: 'special' | 'general'): PoItemRow[] {
  return (order.items || []).filter((item) => item.itemCategory === category);
}

export default function PoOrdersPage() {
  const user = useAuthStore((s) => s.user);
  const admin = user?.role === 'super_admin';
  const canClear = admin && canUseDangerousClear();
  const [status, setStatus] = useState<'matched' | 'pending'>('matched'),
    [data, setData] = useState<PoOrder[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false),
    [clearing, setClearing] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [generating, setGenerating] = useState(false),
    [match, setMatch] = useState<PoOrder>(),
    [form] = Form.useForm();

  useEffect(() => {
    if (!admin && status === 'pending') setStatus('matched');
  }, [admin, status]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchPoOrders({ page, limit: 10, matchStatus: status });
      setData(r.list);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, status]);
  useEffect(() => {
    void load();
  }, [load]);
  const submitMatch = async () => {
    const v = await form.validateFields();
    await matchPoOrder(match!.id, v.gspCaseNo);
    message.success('PO已挂接案例');
    setMatch(undefined);
    form.resetFields();
    void load();
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
  return (
    <Card className="finance-card">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={admin ? '第二次导入：钉钉 PO 表（单文件）' : '本网格已匹配 PO'}
        description={
          admin
            ? '从钉钉导出的一张 PO Excel 即可（表很宽：左侧案例/产品信息，右侧专用与通用服务条目）。合并单元格格式不统一也可导入。按 GSP 案例号挂接第一次导入的案例并补全价格数量。未找到案例的 PO 进入「待匹配」。点击行左侧展开可查看专用/通用条目明细。'
            : '仅显示已挂接到本网格案例的 PO。未匹配、未分配网格的 PO 由管理员处理。'
        }
      />
      {admin && (
      <div className="finance-toolbar">
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
          setStatus(v as any);
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
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        scroll={{ x: 1600 }}
        expandable={{
          expandedRowRender: (r) => {
            const special = itemsOf(r, 'special');
            const general = itemsOf(r, 'general');
            return (
              <div style={{ display: 'grid', gap: 12 }}>
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
            width: 110,
            ellipsis: true,
            render: (v) => v || '-',
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
            ellipsis: true,
            render: (v) => v || '-',
          },
          {
            title: '项目名称',
            dataIndex: 'projectName',
            width: 200,
            ellipsis: true,
            render: (v) => v || '-',
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
            width: 100,
            fixed: 'right',
            render: (_, r) =>
              r.matchStatus === 'pending' ? (
                <Button type="link" icon={<LinkOutlined />} onClick={() => setMatch(r)}>
                  人工挂接
                </Button>
              ) : null,
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
    </Card>
  );
}
