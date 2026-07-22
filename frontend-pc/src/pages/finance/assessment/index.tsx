import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import dayjs from 'dayjs';
import {
  createAssessmentEvent,
  deleteAssessmentEvent,
  fetchAssessmentEventCatalog,
  fetchAssessmentEvents,
  fetchFinanceAssessments,
  rankFinanceAssessments,
  saveFinanceAssessment,
} from '../../../api/finance';
import type { AssessmentEventCatalogItem, AssessmentEventRow, FinanceAssessment } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';

export default function FinanceAssessmentPage() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'super_admin');
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [rows, setRows] = useState<FinanceAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<AssessmentEventCatalogItem[]>([]);
  const [eventUser, setEventUser] = useState<FinanceAssessment>();
  const [events, setEvents] = useState<AssessmentEventRow[]>([]);
  const [eventOpen, setEventOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchFinanceAssessments(month));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchAssessmentEventCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  const patchRow = (userId: string, key: keyof FinanceAssessment, value: unknown) =>
    setRows((current) =>
      current.map((item) => (item.userId === userId ? { ...item, [key]: value } : item)),
    );

  const save = async (row: FinanceAssessment) => {
    await saveFinanceAssessment({
      month,
      userId: row.userId,
      internalScore: Number(row.internalScore || 0),
      rewardAmount: Number(row.rewardAmount || 0),
      toolSubsidy: Number(row.toolSubsidy || 0),
      otherSubsidy: Number(row.otherSubsidy || 0),
      subsidyRemark: row.subsidyRemark,
    });
    message.success('考核与补助已保存');
    await load();
  };

  const openEvents = async (row: FinanceAssessment) => {
    setEventUser(row);
    setEventOpen(true);
    setEvents(await fetchAssessmentEvents(month, row.userId));
    form.resetFields();
  };

  const selectedCatalogId = Form.useWatch('catalogId', form);
  const selectedCatalog = useMemo(
    () => catalog.find((item) => item.id === selectedCatalogId),
    [catalog, selectedCatalogId],
  );

  const submitEvent = async () => {
    if (!eventUser) return;
    const values = await form.validateFields();
    await createAssessmentEvent({
      month,
      userId: eventUser.userId,
      catalogId: values.catalogId,
      qty: values.qty,
      amount: values.amount,
      remark: values.remark,
    });
    message.success('事件扣罚已登记');
    setEvents(await fetchAssessmentEvents(month, eventUser.userId));
    form.resetFields();
    await load();
  };

  const removeEvent = (id: string) => {
    Modal.confirm({
      title: '删除该事件扣罚？',
      onOk: async () => {
        if (!eventUser) return;
        await deleteAssessmentEvent(id);
        setEvents(await fetchAssessmentEvents(month, eventUser.userId));
        await load();
        message.success('已删除');
      },
    });
  };

  const input = (row: FinanceAssessment, key: keyof FinanceAssessment, max?: number) => (
    <InputNumber
      min={key === 'rewardAmount' ? undefined : 0}
      max={max}
      value={Number(row[key] || 0)}
      onChange={(value) => patchRow(row.userId, key, value || 0)}
    />
  );

  return (
    <Card className="finance-card" title="月度考核与补助">
      <div className="finance-review-tip">
        月度考核 = 打分排名考核 + 专业指标事件考核。内部考核表按总分排名（站长/网格长优劣各 1
        名±500，工程师优劣各 3 名±300）；事件按细则按件扣罚。已取消原「内部 60% + 阳光 40%」加权。
      </div>
      <Space className="finance-toolbar">
        <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        <Button onClick={load}>查询</Button>
        <Button
          type="primary"
          onClick={async () => {
            await rankFinanceAssessments(month);
            message.success('分组排名已更新，奖罚已按规则联动');
            await load();
          }}
        >
          一键分组排名并联动奖罚
        </Button>
      </Space>
      <Table
        rowKey="userId"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1400 }}
        columns={[
          { title: '姓名', dataIndex: 'realName', fixed: 'left', width: 110 },
          {
            title: '角色',
            dataIndex: 'userRole',
            width: 110,
            render: (v) => (v === 'site_manager' ? '站长' : '工程师'),
          },
          {
            title: '区域',
            dataIndex: 'region',
            width: 90,
            render: (v) => (v === 'yunnan' ? '云南' : '华南'),
          },
          {
            title: '内部考核总分',
            width: 130,
            render: (_, row) => input(row, 'internalScore', 100),
          },
          {
            title: '排名',
            dataIndex: 'rankResult',
            width: 100,
            render: (v) => (
              <Tag color={v === '优秀' ? 'green' : v === '不称职' || v === '待提升' ? 'red' : 'default'}>
                {v || '待排名'}
              </Tag>
            ),
          },
          {
            title: '排名奖罚',
            width: 120,
            render: (_, row) =>
              isAdmin ? input(row, 'rewardAmount') : `¥${Number(row.rewardAmount || 0).toFixed(2)}`,
          },
          {
            title: '事件扣罚',
            width: 110,
            render: (_, row) => (
              <Button type="link" onClick={() => void openEvents(row)}>
                ¥{Number(row.eventPenalty || 0).toFixed(2)}
              </Button>
            ),
          },
          { title: '工具补助', width: 120, render: (_, row) => input(row, 'toolSubsidy') },
          { title: '其他补助', width: 120, render: (_, row) => input(row, 'otherSubsidy') },
          {
            title: '补助说明',
            width: 160,
            render: (_, row) => (
              <Input
                value={row.subsidyRemark}
                onChange={(event) => patchRow(row.userId, 'subsidyRemark', event.target.value)}
              />
            ),
          },
          {
            title: '操作',
            fixed: 'right',
            width: 150,
            render: (_, row) => (
              <Space>
                <Button type="link" onClick={() => void save(row)}>
                  保存
                </Button>
                <Button type="link" onClick={() => void openEvents(row)}>
                  事件
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        width={720}
        open={eventOpen}
        onClose={() => setEventOpen(false)}
        title={`专业指标事件考核 · ${eventUser?.realName || ''}`}
      >
        <Form form={form} layout="vertical" initialValues={{ qty: 1 }}>
          <Form.Item name="catalogId" label="考核细则" rules={[{ required: true, message: '请选择细则' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={catalog.map((item) => ({
                value: item.id,
                label: `${item.category}｜${item.content}（${item.unitAmount == null ? '自定义金额' : `${item.unitAmount}元/${item.unit}`}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="qty" label="次数/天数" rules={[{ required: true }]}>
            <InputNumber min={0.01} style={{ width: '100%' }} />
          </Form.Item>
          {selectedCatalog?.unitAmount == null && (
            <Form.Item name="amount" label="自定义扣罚金额" rules={[{ required: true, message: '请填写金额' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button type="primary" onClick={() => void submitEvent()}>
            登记扣罚
          </Button>
        </Form>
        <Table
          style={{ marginTop: 24 }}
          rowKey="id"
          size="small"
          dataSource={events}
          pagination={false}
          columns={[
            { title: '类别', dataIndex: 'category', width: 140 },
            { title: '内容', dataIndex: 'content' },
            {
              title: '数量',
              width: 90,
              render: (_, row) => `${row.qty}${row.unit}`,
            },
            {
              title: '扣罚',
              dataIndex: 'amount',
              width: 90,
              render: (v) => `¥${Number(v).toFixed(2)}`,
            },
            {
              title: '操作',
              width: 80,
              render: (_, row) => (
                <Button type="link" danger onClick={() => removeEvent(row.id)}>
                  删除
                </Button>
              ),
            },
          ]}
        />
      </Drawer>
    </Card>
  );
}
