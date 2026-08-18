import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import {
  correctMonthlySettlement,
  exportMonthlySettlements,
  fetchMonthlySettlements,
  lockMonthlySettlements,
  unlockMonthlySettlements,
} from '../../../api/finance';
import { fetchSites } from '../../../api/site';
import type { FinanceMonthlySettlement } from '../../../types/finance';
import type { SiteItem } from '../../../types';
import { useAuthStore } from '../../../stores/auth';

export default function FinanceMonthlyPage() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'super_admin');
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<string>();
  const [siteId, setSiteId] = useState<string>();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [rows, setRows] = useState<FinanceMonthlySettlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<FinanceMonthlySettlement>();
  const [lockBusy, setLockBusy] = useState(false);
  const [form] = Form.useForm();
  const monthLocked = rows.length > 0 && rows.some((row) => row.status === 'locked');
  const monthFullyLocked = rows.length > 0 && rows.every((row) => row.status === 'locked');

  useEffect(() => {
    if (!isAdmin) return;
    void fetchSites({ page: 1, limit: 100 })
      .then((res) => setSites(res.list || []))
      .catch(() => setSites([]));
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        await fetchMonthlySettlements({
          month,
          keyword: keyword || undefined,
          siteId: isAdmin ? siteId : undefined,
          role: isAdmin ? role : undefined,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [month, keyword, siteId, role, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (value: unknown) => `¥${Number(value || 0).toFixed(2)}`;
  const sum = (data: readonly FinanceMonthlySettlement[], key: keyof FinanceMonthlySettlement) =>
    data.reduce((s, r) => s + Number(r[key] || 0), 0);

  return (
    <Card className="finance-card" title="月度结算">
      <div className="finance-review-tip">
        最终金额 = 已审核计件绩效 + 已通过行程报销 + 排名奖罚 − 事件扣罚 + 补助 + 校正增补。打开本页或结算/报销审核通过时会自动重算。网格长只读本网格；锁定/解锁、校正、导出仅管理员。锁定后该月已通过结算的案例变为「已月结」，不能再改 PO；解锁后回到「已结算」。
      </div>
      <Space className="finance-toolbar" wrap>
        <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        <Input
          allowClear
          placeholder="姓名/账号"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ width: 160 }}
        />
        {isAdmin && (
          <>
            <Select
              allowClear
              placeholder="角色"
              value={role}
              onChange={setRole}
              style={{ width: 120 }}
              options={[
                { value: 'inspector', label: '工程师' },
                { value: 'site_manager', label: '网格长' },
              ]}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="网格"
              value={siteId}
              onChange={setSiteId}
              style={{ width: 180 }}
              options={sites.map((site) => ({ value: site.id, label: site.name }))}
            />
          </>
        )}
        <Button onClick={load}>查询</Button>
        {isAdmin && (
          <>
            <Button disabled={!rows.length} onClick={() => exportMonthlySettlements(month, 'reconcile')}>
              导出对账表
            </Button>
            <Button disabled={!rows.length} onClick={() => exportMonthlySettlements(month, 'payroll')}>
              导出发薪表
            </Button>
            {!monthFullyLocked ? (
              <Button
                type="primary"
                disabled={!rows.length}
                loading={lockBusy}
                onClick={() => {
                  Modal.confirm({
                    title: `锁定 ${month} 月结？`,
                    content:
                      '锁定后，本月已通过结算的案例会变成「已月结」：管理员也不能再改 PO、不能再自动重算。需要纠偏时再解锁。',
                    okText: '锁定',
                    cancelText: '取消',
                    onOk: async () => {
                      setLockBusy(true);
                      try {
                        const result = await lockMonthlySettlements(month);
                        message.success(`已锁定 ${result.locked} 人`);
                        await load();
                      } finally {
                        setLockBusy(false);
                      }
                    },
                  });
                }}
              >
                锁定本月
              </Button>
            ) : null}
            {monthLocked ? (
              <Button
                danger
                disabled={!rows.length}
                loading={lockBusy}
                onClick={() => {
                  Modal.confirm({
                    title: `解锁 ${month} 月结？`,
                    content:
                      '解锁后，本月案例从「已月结」回到「已结算」。浏览页面仍不会自动改价，但管理员保存 PO 可以重算纠偏。',
                    okText: '解锁',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: async () => {
                      setLockBusy(true);
                      try {
                        const result = await unlockMonthlySettlements(month);
                        message.success(
                          `已解锁 ${result.unlocked} 人` +
                            (result.unlockedCases ? `，${result.unlockedCases} 个案例回到已结算` : ''),
                        );
                        await load();
                      } finally {
                        setLockBusy(false);
                      }
                    },
                  });
                }}
              >
                解锁本月
              </Button>
            ) : null}
          </>
        )}
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1280 }}
        summary={(data) => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2}>{money(sum(data, 'perfTotal'))}</Table.Summary.Cell>
            <Table.Summary.Cell index={3}>{money(sum(data, 'expenseTotal'))}</Table.Summary.Cell>
            <Table.Summary.Cell index={4}>{money(sum(data, 'rewardTotal'))}</Table.Summary.Cell>
            <Table.Summary.Cell index={5}>{money(sum(data, 'eventPenalty'))}</Table.Summary.Cell>
            <Table.Summary.Cell index={6}>{money(sum(data, 'subsidyTotal'))}</Table.Summary.Cell>
            <Table.Summary.Cell index={7}>{money(sum(data, 'correctionTotal'))}</Table.Summary.Cell>
            <Table.Summary.Cell index={8}>
              <b>{money(sum(data, 'finalAmount'))}</b>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={9} />
            <Table.Summary.Cell index={10} />
          </Table.Summary.Row>
        )}
        columns={[
          { title: '姓名', dataIndex: ['user', 'realName'], fixed: 'left', width: 120 },
          { title: '账号', dataIndex: ['user', 'username'], width: 120 },
          { title: '计件绩效', dataIndex: 'perfTotal', width: 120, render: money },
          {
            title: '行程报销',
            dataIndex: 'expenseTotal',
            width: 120,
            render: (v) => money(v || 0),
          },
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
