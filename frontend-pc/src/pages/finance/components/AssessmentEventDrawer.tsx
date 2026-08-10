import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Form, Input, InputNumber, Modal, Select, Table, Tag, message } from 'antd';
import {
  createAssessmentEvent,
  deleteAssessmentEvent,
  fetchAssessmentEventCatalog,
  fetchAssessmentEvents,
} from '../../../api/finance';
import type { AssessmentEventCatalogItem, AssessmentEventRow } from '../../../types/finance';

export type AssessmentEventAssignee = {
  id: string;
  realName: string;
};

export type AssessmentEventDrawerProps = {
  open: boolean;
  onClose: () => void;
  month: string;
  /** 单人场景直接传入；多人场景可留空，改用 assignees */
  userId?: string;
  userName?: string;
  /** 案例在派工程师列表；多人时必须先选扣罚对象 */
  assignees?: AssessmentEventAssignee[];
  /** 关联案例时只展示/登记本案例事件 */
  serviceCaseId?: string;
  caseLabel?: string;
  onChanged?: () => void;
};

export default function AssessmentEventDrawer({
  open,
  onClose,
  month,
  userId,
  userName,
  assignees,
  serviceCaseId,
  caseLabel,
  onChanged,
}: AssessmentEventDrawerProps) {
  const [catalog, setCatalog] = useState<AssessmentEventCatalogItem[]>([]);
  const [events, setEvents] = useState<AssessmentEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const people = useMemo(() => {
    if (assignees?.length) return assignees;
    if (userId) return [{ id: userId, realName: userName || userId }];
    return [];
  }, [assignees, userId, userName]);

  const multiPerson = people.length > 1;
  const selectedCatalogId = Form.useWatch('catalogId', form);
  const selectedCatalog = useMemo(
    () => catalog.find((item) => item.id === selectedCatalogId),
    [catalog, selectedCatalogId],
  );

  const reload = async () => {
    if (!serviceCaseId && !people[0]?.id) return;
    setLoading(true);
    try {
      setEvents(
        await fetchAssessmentEvents(
          month,
          serviceCaseId ? undefined : people[0]?.id,
          serviceCaseId,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void fetchAssessmentEventCatalog().then(setCatalog).catch(() => setCatalog([]));
    form.resetFields();
    form.setFieldsValue({
      qty: 1,
      userId: multiPerson ? undefined : people[0]?.id,
    });
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, month, serviceCaseId, people.map((p) => p.id).join(',')]);

  const submitEvent = async () => {
    const values = await form.validateFields();
    const targetUserId = String(values.userId || people[0]?.id || '');
    if (!targetUserId) {
      message.warning('请选择要扣罚的工程师');
      return;
    }
    await createAssessmentEvent({
      month,
      userId: targetUserId,
      catalogId: values.catalogId,
      qty: values.qty,
      amount: values.amount,
      remark: values.remark,
      ...(serviceCaseId ? { serviceCaseId } : {}),
    });
    message.success('事件扣罚已登记');
    form.resetFields();
    form.setFieldsValue({
      qty: 1,
      userId: multiPerson ? undefined : people[0]?.id,
    });
    await reload();
    onChanged?.();
  };

  const removeEvent = (id: string) => {
    Modal.confirm({
      title: '删除该事件扣罚？',
      onOk: async () => {
        await deleteAssessmentEvent(id);
        await reload();
        onChanged?.();
        message.success('已删除');
      },
    });
  };

  const title = serviceCaseId
    ? `事件扣罚 · ${caseLabel || ''}`
    : `专业指标事件考核 · ${userName || people[0]?.realName || ''}`;

  return (
    <Drawer width={720} open={open} onClose={onClose} title={title}>
      {serviceCaseId && (
        <div style={{ marginBottom: 12, color: '#666' }}>
          {multiPerson
            ? `多人案例请先选择扣罚对象；扣罚只计入该工程师 ${month} 月汇总，并关联本案例追溯。`
            : `本条扣罚计入工程师 ${month} 月事件扣罚汇总，并关联当前案例便于一单一算追溯。`}
        </div>
      )}
      <Form form={form} layout="vertical" initialValues={{ qty: 1 }}>
        <Form.Item
          name="userId"
          label="扣罚对象"
          rules={[{ required: true, message: '请选择要扣罚的工程师' }]}
        >
          <Select
            placeholder={multiPerson ? '选择本次扣罚的工程师' : undefined}
            options={people.map((p) => ({
              value: p.id,
              label: p.realName || p.id,
            }))}
            disabled={!multiPerson && people.length === 1}
          />
        </Form.Item>
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
        loading={loading}
        dataSource={events}
        pagination={false}
        columns={[
          ...(serviceCaseId || multiPerson
            ? [
                {
                  title: '工程师',
                  width: 100,
                  render: (_: unknown, row: AssessmentEventRow) =>
                    row.userName ||
                    people.find((p) => p.id === row.userId)?.realName ||
                    row.userId,
                },
              ]
            : []),
          { title: '类别', dataIndex: 'category', width: 120 },
          { title: '内容', dataIndex: 'content' },
          {
            title: '数量',
            width: 90,
            render: (_: unknown, row: AssessmentEventRow) => `${row.qty}${row.unit}`,
          },
          {
            title: '扣罚',
            dataIndex: 'amount',
            width: 90,
            render: (v: string) => `¥${Number(v).toFixed(2)}`,
          },
          ...(!serviceCaseId
            ? [
                {
                  title: '关联案例',
                  width: 100,
                  render: (_: unknown, row: AssessmentEventRow) =>
                    row.serviceCaseId ? <Tag color="blue">已关联</Tag> : <Tag>月度</Tag>,
                },
              ]
            : []),
          {
            title: '操作',
            width: 80,
            render: (_: unknown, row: AssessmentEventRow) => (
              <Button type="link" danger onClick={() => removeEvent(row.id)}>
                删除
              </Button>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
