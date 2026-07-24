import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Table, Tag, Tabs, message } from 'antd';
import { DeleteOutlined, DownloadOutlined, LinkOutlined, SyncOutlined } from '@ant-design/icons';
import { clearPoOrders, fetchPoOrders, generateCasesFromPo, matchPoOrder } from '../../../api/finance';
import type { PoOrder } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';
import ImportDialog from '../components/ImportDialog';

export default function PoOrdersPage() {
  const user = useAuthStore((s) => s.user);
  const admin = user?.role === 'super_admin';
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
      title: '从 PO 反向生成案例',
      content:
        '系统将按 GSP 案例号补建案例，状态设为“待结算审核”，并自动挂接历史待匹配 PO。已有案例不会重复创建。',
      okText: '开始生成',
      cancelText: '取消',
      onOk: async () => {
        setGenerating(true);
        try {
          const result = await generateCasesFromPo();
          message.success(
            `生成案例 ${result.generatedCases} 个，成功匹配 PO ${result.matchedOrders} 个`,
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
  const onClear = () => {
    Modal.confirm({
      title: '清空全部 PO？',
      content: '将删除全部 PO 订单及其明细，且不可恢复。案例本身不会删除。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setClearing(true);
        try {
          const result = await clearPoOrders();
          message.success(`已清空 ${result.deleted} 条 PO`);
          setPage(1);
          await load();
        } finally {
          setClearing(false);
        }
      },
    });
  };
  return (
    <Card className="finance-card">
      <div className="finance-toolbar">
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => setImportOpen(true)}>
          导入 PO
        </Button>
        <Button icon={<SyncOutlined />} loading={generating} onClick={generateCases}>
          从 PO 生成案例并匹配
        </Button>
        {admin && (
          <Button danger icon={<DeleteOutlined />} loading={clearing} onClick={onClear}>
            清空全部 PO
          </Button>
        )}
      </div>
      <Tabs
        activeKey={status}
        onChange={(v) => {
          setPage(1);
          setStatus(v as any);
        }}
        items={[
          { key: 'matched', label: '已匹配' },
          { key: 'pending', label: '待匹配队列' },
        ]}
      />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'PO单号', dataIndex: 'poNo', width: 150 },
          { title: 'GSP案例号', dataIndex: 'gspCaseNo', width: 150 },
          { title: '项目', dataIndex: 'projectName' },
          { title: '省份', dataIndex: 'province', width: 80 },
          { title: '需求类型', dataIndex: 'demandType', width: 90 },
          {
            title: 'PO总额',
            dataIndex: 'poTotalAmount',
            width: 130,
            render: (v) => <span className="finance-money">¥ {Number(v).toFixed(2)}</span>,
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
