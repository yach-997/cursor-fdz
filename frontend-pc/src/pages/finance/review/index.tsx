import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Space, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import {
  approveFinanceReview,
  fetchPendingFinanceReviews,
  rejectFinanceReview,
  reviewFinanceDeduction,
  saveFinanceDeduction,
} from '../../../api/finance';
import type { FinanceReviewItem } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';

type Action = 'approve' | 'reject' | 'deduction';

export default function FinanceReviewPage() {
  const user = useAuthStore((state) => state.user);
  const [rows, setRows] = useState<FinanceReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<FinanceReviewItem>();
  const [action, setAction] = useState<Action>();
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchPendingFinanceReviews());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const submit = async () => {
    if (!current || !action) return;
    const values = await form.validateFields();
    if (action === 'approve') await approveFinanceReview(current.id, values.comment);
    if (action === 'reject') await rejectFinanceReview(current.id, values.reason);
    if (action === 'deduction')
      await saveFinanceDeduction(current.id, Number(values.amount), values.reason);
    message.success(action === 'approve' ? '结算审核已通过' : action === 'reject' ? '已驳回并记录原因' : '特殊扣减已保存');
    setAction(undefined);
    setCurrent(undefined);
    form.resetFields();
    await load();
  };

  return (
    <Card className="finance-card" title="待结算审核">
      <div className="finance-review-tip">案例完工后 7 天内完成审核；超期案例会红色提示。站长录入的特殊扣减须管理员复核。</div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1100 }}
        columns={[
          { title: '案例号', dataIndex: 'gspCaseNo', width: 145 },
          { title: '项目', dataIndex: 'projectName', ellipsis: true },
          { title: '工程师', dataIndex: 'inspectorName', width: 100, render: (v) => v || '-' },
          {
            title: '资料完整性',
            width: 135,
            render: (_, row) => row.approvalReady
              ? <Tag color="green">可审核</Tag>
              : <Tag color="orange">{!row.inspectorName ? '未派工程师' : `缺绩效价 ${row.missingPerf} 项`}</Tag>,
          },
          { title: '完工时间', dataIndex: 'finishTime', width: 160, render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-') },
          {
            title: '审核时限',
            width: 130,
            render: (_, row) => row.overdue ? <Tag color="red">已超期</Tag> : <Tag color="gold">剩余 {Math.max(0, row.remainingHours || 0)} 小时</Tag>,
          },
          { title: '案例收入', dataIndex: 'caseRevenue', width: 110, render: (v) => `¥${Number(v).toFixed(2)}` },
          { title: '计件绩效', dataIndex: 'perfBase', width: 110, render: (v) => `¥${Number(v).toFixed(2)}` },
          { title: '扣减', dataIndex: 'deduction', width: 90, render: (v) => `¥${Number(v).toFixed(2)}` },
          {
            title: '操作',
            fixed: 'right',
            width: 250,
            render: (_, row) => (
              <Space>
                <Button type="link" onClick={() => { setCurrent(row); setAction('deduction'); }}>扣减</Button>
                {row.deductionStatus === 'pending' && user?.role === 'super_admin' && (
                  <Button type="link" onClick={async () => { await reviewFinanceDeduction(row.id, true); message.success('扣减复核通过'); await load(); }}>复核扣减</Button>
                )}
                <Button type="link" danger onClick={() => { setCurrent(row); setAction('reject'); }}>驳回</Button>
                <Button type="primary" disabled={!row.approvalReady || row.deductionStatus === 'pending'} onClick={() => { setCurrent(row); setAction('approve'); }}>通过</Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!action}
        title={action === 'approve' ? '通过结算审核' : action === 'reject' ? '驳回结算审核' : '录入特殊扣减'}
        okText="确认"
        cancelText="取消"
        onCancel={() => { setAction(undefined); setCurrent(undefined); form.resetFields(); }}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          {action === 'deduction' && (
            <Form.Item name="amount" label="扣减金额（元）" rules={[{ required: true, message: '请输入扣减金额' }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          )}
          {action !== 'approve' && (
            <Form.Item name="reason" label="原因" rules={[{ required: true, message: '请填写原因' }]}>
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          )}
          {action === 'approve' && <Form.Item name="comment" label="审核意见（可选）"><Input.TextArea rows={3} /></Form.Item>}
        </Form>
      </Modal>
    </Card>
  );
}
