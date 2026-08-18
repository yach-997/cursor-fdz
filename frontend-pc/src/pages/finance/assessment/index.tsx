import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, InputNumber, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { DeleteOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  clearFinanceAssessments,
  fetchFinanceAssessments,
  rankFinanceAssessments,
  saveFinanceAssessment,
} from '../../../api/finance';
import { fetchSites } from '../../../api/site';
import type { FinanceAssessment } from '../../../types/finance';
import type { SiteItem } from '../../../types';
import { useAuthStore } from '../../../stores/auth';
import { canUseDangerousClear, confirmDangerousClear } from '../../../utils/finance-clear';
import AssessmentEventDrawer from '../components/AssessmentEventDrawer';
import AssessmentScoreRuleDrawer from '../components/AssessmentScoreRuleDrawer';
import AssessmentScoreDrawer from '../components/AssessmentScoreDrawer';

const colTip = (title: string, tip: string) => (
  <span>
    {title}{' '}
    <Tooltip title={tip}>
      <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
    </Tooltip>
  </span>
);

export default function FinanceAssessmentPage() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'super_admin';
  const isManager = user?.role === 'site_manager';
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<string>();
  const [siteId, setSiteId] = useState<string>();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [rows, setRows] = useState<FinanceAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [eventTarget, setEventTarget] = useState<FinanceAssessment>();
  const [scoreTarget, setScoreTarget] = useState<FinanceAssessment>();
  const [ruleOpen, setRuleOpen] = useState(false);

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
        await fetchFinanceAssessments({
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

  const patchRow = (userId: string, key: keyof FinanceAssessment, value: unknown) =>
    setRows((current) =>
      current.map((item) => (item.userId === userId ? { ...item, [key]: value } : item)),
    );

  const save = async (row: FinanceAssessment) => {
    if (isManager && row.userId === user?.id) {
      message.warning('不能给自己打分，请由管理员录入');
      return;
    }
    await saveFinanceAssessment({
      month,
      userId: row.userId,
      rewardAmount: Number(row.rewardAmount || 0),
      toolSubsidy: Number(row.toolSubsidy || 0),
      otherSubsidy: Number(row.otherSubsidy || 0),
      subsidyRemark: row.subsidyRemark,
    });
    message.success('补助已保存');
    await load();
  };

  const rank = async (mode: 'site_preview' | 'company_inspectors' | 'company_managers') => {
    if (mode === 'site_preview' && isAdmin && !siteId) {
      message.warning('请先选择网格，再生成网格内名次');
      return;
    }
    await rankFinanceAssessments(month, mode, mode === 'site_preview' ? siteId : undefined);
    message.success(
      mode === 'site_preview'
        ? '本网格名次已按分数生成（第1/2/3…名，不发奖罚）'
        : mode === 'company_inspectors'
          ? '全公司工程师正式排名与奖罚已更新'
          : '全公司网格长正式排名与奖罚已更新',
    );
    await load();
  };

  const onClear = async () => {
    const ok = await confirmDangerousClear({
      title: '清空全部考核数据？',
      description:
        '将删除所有考核分数、排名奖罚、事件扣罚与月度结算草稿。不影响案例、PO、价格库与账号。',
    });
    if (!ok) return;
    setClearing(true);
    try {
      const result = await clearFinanceAssessments();
      message.success(
        `已清空考核 ${result.deleted.assessment}、事件 ${result.deleted.assessmentEvent}、月结 ${result.deleted.monthlySettlement}`,
      );
      await load();
    } finally {
      setClearing(false);
    }
  };

  const isSelfRow = (row: FinanceAssessment) => isManager && row.userId === user?.id;

  const input = (
    row: FinanceAssessment,
    key: keyof FinanceAssessment,
    max?: number,
    disabled?: boolean,
  ) => (
    <InputNumber
      min={key === 'rewardAmount' ? undefined : 0}
      max={max}
      disabled={disabled}
      value={Number(row[key] || 0)}
      onChange={(value) => patchRow(row.userId, key, value || 0)}
    />
  );

  const companyRankTag = (v?: string | null) => {
    if (!v) return <Tag>待排名</Tag>;
    return (
      <Tag color={v === '优秀' ? 'green' : v === '不称职' || v === '待提升' ? 'red' : 'default'}>
        {v}
      </Tag>
    );
  };

  const roleLabel = (v?: string) => {
    if (v === 'dual') return '网格长兼工程师';
    if (v === 'site_manager') return '网格长';
    return '工程师';
  };

  const siteRankTag = (row: FinanceAssessment) => {
    if (row.userRole === 'site_manager') return <Tag>-</Tag>;
    if (!row.siteRankResult) {
      return <Tag>{row.siteName ? '待排名' : '未挂网格'}</Tag>;
    }
    if (/^\d+$/.test(row.siteRankResult)) {
      return (
        <Tag color="blue">
          第{row.siteRankResult}名{row.siteName ? ` · ${row.siteName}` : ''}
        </Tag>
      );
    }
    return <Tag>{row.siteRankResult}</Tag>;
  };

  return (
    <Card className="finance-card" title="月度考核与补助">
      <div className="finance-review-tip">
        {isManager
          ? '本页给本网格已聘工程师打分（含自己兼工程师且已聘网格）。不能改自己的分数，本人考核由管理员录入。点「打分」按规则填分项，总分自动汇总。网格内名次仅参考；全司奖罚：兼岗只进网格长池。'
          : '点「打分」按规则录入分项，内部考核总分自动计算。网格内名次按各网格；全司工程师优/劣各3±300，网格长优/劣各1±500。'}
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
              style={{ width: 140 }}
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
        {isManager && (
          <Button type="primary" onClick={() => void rank('site_preview')}>
            一键排名本网格工程师
          </Button>
        )}
        {isAdmin && (
          <>
            <Button onClick={() => void rank('site_preview')}>按当前网格生成网格内名次</Button>
            <Button type="primary" onClick={() => void rank('company_inspectors')}>
              一键排名全公司工程师
            </Button>
            <Button type="primary" onClick={() => void rank('company_managers')}>
              一键排名全公司网格长
            </Button>
            <Button onClick={() => setRuleOpen(true)}>打分规则配置</Button>
            {canUseDangerousClear() && (
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={clearing}
                onClick={() => void onClear()}
              >
                清空考核数据
              </Button>
            )}
          </>
        )}
      </Space>
      <Table
        rowKey="userId"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1680 }}
        locale={{
          emptyText: isManager
            ? '本网格暂无已聘工程师。请到用户管理「聘用到网格」，兼工程师的网格长也需聘到本网格后才会出现。'
            : '暂无考核人员',
        }}
        columns={[
          { title: '姓名', dataIndex: 'realName', fixed: 'left', width: 110 },
          {
            title: '角色',
            dataIndex: 'userRole',
            width: 140,
            render: (v) => roleLabel(v),
          },
          {
            title: '所属网格',
            dataIndex: 'siteName',
            width: 160,
            ellipsis: true,
            render: (v) => v || '未挂网格',
          },
          {
            title: colTip('内部考核总分', '由「打分」分项自动汇总，不可手改'),
            width: 130,
            render: (_, row) => (
              <span>
                {Number(row.internalScore || row.totalScore || 0).toFixed(2)}
                {row.scored ? (
                  <Tag color="green" style={{ marginLeft: 6 }}>
                    已打分
                  </Tag>
                ) : null}
              </span>
            ),
          },
          {
            title: '网格内名次',
            dataIndex: 'siteRankResult',
            width: 160,
            render: (_, row) => siteRankTag(row),
          },
          {
            title: '全司排名',
            dataIndex: 'rankResult',
            width: 100,
            render: (v) => companyRankTag(v),
          },
          {
            title: '排名奖罚',
            width: 120,
            render: (_, row) =>
              isAdmin ? input(row, 'rewardAmount') : `¥${Number(row.rewardAmount || 0).toFixed(2)}`,
          },
          {
            title: colTip(
              '事件扣罚',
              '本月已登记合计（与结算审核同一数据）。点「事件」可补录或查看明细；有案例时建议优先在结算审核登记。',
            ),
            dataIndex: 'eventPenalty',
            width: 110,
            render: (v) => `¥${Number(v || 0).toFixed(2)}`,
          },
          {
            title: '工具补助',
            width: 120,
            render: (_, row) => input(row, 'toolSubsidy', undefined, isSelfRow(row)),
          },
          {
            title: '其他补助',
            width: 120,
            render: (_, row) => input(row, 'otherSubsidy', undefined, isSelfRow(row)),
          },
          {
            title: '补助说明',
            width: 160,
            render: (_, row) => (
              <Input
                disabled={isSelfRow(row)}
                value={row.subsidyRemark}
                onChange={(event) => patchRow(row.userId, 'subsidyRemark', event.target.value)}
              />
            ),
          },
          {
            title: '操作',
            fixed: 'right',
            width: 210,
            render: (_, row) =>
              isSelfRow(row) ? (
                <Tag>管理员录入</Tag>
              ) : (
                <Space size={0}>
                  <Button type="link" onClick={() => setScoreTarget(row)}>
                    打分
                  </Button>
                  <Button type="link" onClick={() => void save(row)}>
                    保存
                  </Button>
                  <Button type="link" onClick={() => setEventTarget(row)}>
                    事件明细
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <AssessmentEventDrawer
        open={!!eventTarget}
        onClose={() => setEventTarget(undefined)}
        month={month}
        userId={eventTarget?.userId}
        userName={eventTarget?.realName}
        onChanged={() => void load()}
      />
      <AssessmentScoreRuleDrawer open={ruleOpen} onClose={() => setRuleOpen(false)} />
      <AssessmentScoreDrawer
        open={!!scoreTarget}
        month={month}
        target={scoreTarget}
        onClose={() => setScoreTarget(undefined)}
        onSaved={() => void load()}
      />
    </Card>
  );
}
