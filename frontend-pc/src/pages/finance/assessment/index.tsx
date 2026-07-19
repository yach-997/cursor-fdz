import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, InputNumber, Space, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { fetchFinanceAssessments, rankFinanceAssessments, saveFinanceAssessment } from '../../../api/finance';
import type { FinanceAssessment } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';

export default function FinanceAssessmentPage() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'super_admin');
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [rows, setRows] = useState<FinanceAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchFinanceAssessments(month)); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => void load(), [load]);
  const patchRow = (userId: string, key: keyof FinanceAssessment, value: unknown) =>
    setRows((current) => current.map((item) => item.userId === userId ? { ...item, [key]: value } : item));
  const save = async (row: FinanceAssessment) => {
    await saveFinanceAssessment({
      month, userId: row.userId,
      internalScore: Number(row.internalScore || 0), sungrowScore: Number(row.sungrowScore || 0),
      rewardAmount: Number(row.rewardAmount || 0), toolSubsidy: Number(row.toolSubsidy || 0),
      otherSubsidy: Number(row.otherSubsidy || 0), subsidyRemark: row.subsidyRemark,
    });
    message.success('考核与补助已保存'); await load();
  };
  const input = (row: FinanceAssessment, key: keyof FinanceAssessment, max?: number) =>
    <InputNumber min={key === 'rewardAmount' ? undefined : 0} max={max} value={Number(row[key] || 0)} onChange={(value) => patchRow(row.userId, key, value || 0)} />;
  return <Card className="finance-card" title="月度考核与补助">
    <div className="finance-review-tip">加权总分 = 内部考核 × 60% + 阳光指标 × 40%。站长维护本区域数据，管理员录入最终奖罚并复核。</div>
    <Space className="finance-toolbar"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><Button onClick={load}>查询</Button><Button type="primary" onClick={async () => { await rankFinanceAssessments(month); message.success('分组排名已更新'); await load(); }}>一键分组排名</Button></Space>
    <Table rowKey="userId" loading={loading} dataSource={rows} scroll={{ x: 1250 }} columns={[
      { title: '姓名', dataIndex: 'realName', fixed: 'left', width: 110 },
      { title: '角色', dataIndex: 'userRole', width: 100, render: (v) => v === 'site_manager' ? '站长' : '巡检员' },
      { title: '区域', dataIndex: 'region', width: 100, render: (v) => v === 'yunnan' ? '云南' : '华南' },
      { title: '内部考核', width: 120, render: (_, row) => input(row, 'internalScore', 100) },
      { title: '阳光指标', width: 120, render: (_, row) => input(row, 'sungrowScore', 100) },
      { title: '加权总分', width: 100, render: (_, row) => (Number(row.internalScore || 0) * .6 + Number(row.sungrowScore || 0) * .4).toFixed(1) },
      { title: '排名', dataIndex: 'rankResult', width: 90, render: (v) => <Tag color={v === '优秀' ? 'green' : v === '待提升' ? 'red' : 'default'}>{v || '待排名'}</Tag> },
      { title: '奖罚', width: 120, render: (_, row) => isAdmin ? input(row, 'rewardAmount') : `¥${Number(row.rewardAmount || 0).toFixed(2)}` },
      { title: '工具补助', width: 120, render: (_, row) => input(row, 'toolSubsidy') },
      { title: '其他补助', width: 120, render: (_, row) => input(row, 'otherSubsidy') },
      { title: '补助说明', width: 180, render: (_, row) => <Input value={row.subsidyRemark} onChange={(event) => patchRow(row.userId, 'subsidyRemark', event.target.value)} /> },
      { title: '操作', fixed: 'right', width: 90, render: (_, row) => <Button type="link" onClick={() => save(row)}>保存</Button> },
    ]} />
  </Card>;
}
