import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Space, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import {
  correctMonthlySettlement,
  exportMonthlySettlements,
  fetchMonthlySettlements,
  lockMonthlySettlements,
} from '../../../api/finance';
import type { FinanceMonthlySettlement } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';

export default function FinanceMonthlyPage() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'super_admin');
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [rows, setRows] = useState<FinanceMonthlySettlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<FinanceMonthlySettlement>();
  const [form] = Form.useForm();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchMonthlySettlements(month));
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  const money = (value: unknown) => `¥${Number(value || 0).toFixed(2)}`;
  return (
    <Card className="finance-card" title="月度结算">
      <div className="finance-review-tip">
        最终金额 = 已审核计件绩效 + 排名奖罚 − 事件扣罚 + 补助 + 校正增补。锁定后不可修改，并同步封存当月案例。
      </div>
      <Space className="finance-toolbar" wrap>
        <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        <Button onClick={load}>查询</Button>
        {isAdmin && (
          <>
            <Button disabled={!rows.length} onClick={() => exportMonthlySettlements(month, 'reconcile')}>
              导出对账表
            </Button>
            <Button disabled={!rows.length} onClick={() => exportMonthlySettlements(month, 'payroll')}>
              导出发薪表
            </Button>
            <Button
              danger
              disabled={!rows.length || rows.every((row) => row.status === 'locked')}
              onClick={() =>
                Modal.confirm({
                  title: `确认锁定 ${month}？`,
                  content: '锁定后不能再修改，请先完成核对。',
                  onOk: async () => {
                    await lockMonthlySettlements(month);
                    message.success('月度结算已锁定');
                    await load();
                  },
                })
              }
            >
              锁定本月
            </Button>
          </>
        )}
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1100 }}
        summary={(data) => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2}>
              {money(data.reduce((s, r) => s + Number(r.perfTotal), 0))}
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3}>
              {money(data.reduce((s, r) => s + Number(r.rewardTotal), 0))}
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4}>
              {money(data.reduce((s, r) => s + Number(r.eventPenalty || 0), 0))}
            </Table.Summary.Cell>
            <Table.Summary.Cell index={5}>
              {money(data.reduce((s, r) => s + Number(r.subsidyTotal), 0))}
            </Table.Summary.Cell>
            <Table.Summary.Cell index={6}>
              {money(data.reduce((s, r) => s + Number(r.correctionTotal), 0))}
            </Table.Summary.Cell>
            <Table.Summary.Cell index={7}>
              <b>{money(data.reduce((s, r) => s + Number(r.finalAmount), 0))}</b>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={8} />
            <Table.Summary.Cell index={9} />
          </Table.Summary.Row>
        )}
        columns={[
          { title: '姓名', dataIndex: ['user', 'realName'], fixed: 'left', width: 120 },
          { title: '账号', dataIndex: ['user', 'username'], width: 120 },
          { title: '计件绩效', dataIndex: 'perfTotal', width: 120, render: money },
          { title: '排名奖罚', dataIndex: 'rewardTotal', width: 110, render: money },
          {
            title: '事件扣罚',
            dataIndex: 'eventPenalty',
            width: 110,
            render: (v) => money(v || 0),
          },
          { title: '补助', dataIndex: 'subsidyTotal', width: 110, render: money },
          { title: '校正增补', dataIndex: 'correctionTotal', width: 120, render: money },
          {
            title: '最终金额',
            dataIndex: 'finalAmount',
            width: 130,
            render: (v) => <b className="finance-money">{money(v)}</b>,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (v) => (
              <Tag color={v === 'locked' ? 'green' : v === 'corrected' ? 'gold' : 'default'}>
                {v === 'locked' ? '已锁定' : v === 'corrected' ? '已校正' : '草稿'}
              </Tag>
            ),
          },
          {
            title: '操作',
            fixed: 'right',
            width: 90,
            render: (_, row) =>
              isAdmin && row.status !== 'locked' ? (
                <Button
                  type="link"
                  onClick={() => {
                    setCurrent(row);
                    form.setFieldsValue({ amount: Number(row.correctionTotal || 0) });
                  }}
                >
                  校正
                </Button>
              ) : (
                '-'
              ),
          },
        ]}
      />
      <Modal
        title={`校正：${current?.user?.realName || ''}`}
        open={!!current}
        onCancel={() => setCurrent(undefined)}
        onOk={async () => {
          const values = await form.validateFields();
          await correctMonthlySettlement(month, current!.userId, Number(values.amount), values.reason);
          message.success('校正已保存并重新计算');
          setCurrent(undefined);
          form.resetFields();
          await load();
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="amount" label="校正增补金额" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="校正原因" rules={[{ required: true, message: '请填写校正原因' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
