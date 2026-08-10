import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  approveFinanceReview,
  fetchFinanceCase,
  fetchPendingFinanceReviews,
  rejectFinanceReview,
  reviewFinanceDeduction,
} from '../../../api/finance';
import { fetchSites } from '../../../api/site';
import type { FinanceReviewItem } from '../../../types/finance';
import type { SiteItem } from '../../../types';
import { useAuthStore } from '../../../stores/auth';
import AssessmentEventDrawer, {
  type AssessmentEventAssignee,
} from '../components/AssessmentEventDrawer';
import SettlementAmountDrawer from '../components/SettlementAmountDrawer';
import { formatDateTime } from '../../../utils/displayLabels';

type Action = 'approve' | 'reject';
type ReviewTab = 'pending' | 'approved' | 'rejected' | 'all';

const tabLabel: Record<ReviewTab, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  all: '全部',
};

const statusTag = (status?: string) => {
  if (status === 'approved') return <Tag color="green">已通过</Tag>;
  if (status === 'rejected') return <Tag color="red">已驳回</Tag>;
  return <Tag color="gold">待审核</Tag>;
};

const moneyText = (v: string | number | undefined | null) => `¥${Number(v || 0).toFixed(2)}`;

const colTip = (title: string, tip: string) => (
  <span>
    {title}{' '}
    <Tooltip title={tip}>
      <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
    </Tooltip>
  </span>
);

export default function FinanceReviewPage() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'super_admin';
  const [tab, setTab] = useState<ReviewTab>('pending');
  const [keyword, setKeyword] = useState('');
  const [month, setMonth] = useState<string>();
  const [siteId, setSiteId] = useState<string>();
  const [overdue, setOverdue] = useState<string>();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [rows, setRows] = useState<FinanceReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<FinanceReviewItem>();
  const [action, setAction] = useState<Action>();
  const [eventCase, setEventCase] = useState<FinanceReviewItem>();
  const [eventAssignees, setEventAssignees] = useState<AssessmentEventAssignee[]>([]);
  const [amountCase, setAmountCase] = useState<FinanceReviewItem>();
  const [form] = Form.useForm();

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
        await fetchPendingFinanceReviews({
          keyword: keyword || undefined,
          month: month || undefined,
          siteId: isAdmin ? siteId : undefined,
          overdue: overdue || undefined,
          reviewStatus: tab,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [keyword, month, siteId, overdue, isAdmin, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!current || !action) return;
    const values = await form.validateFields();
    if (action === 'approve') await approveFinanceReview(current.id, values.comment);
    if (action === 'reject') await rejectFinanceReview(current.id, values.reason);
    message.success(action === 'approve' ? '结算审核已通过' : '已驳回并记录原因');
    setAction(undefined);
    setCurrent(undefined);
    form.resetFields();
    if (action === 'approve') setTab('approved');
    else await load();
  };

  const openEventPenalty = async (row: FinanceReviewItem) => {
    setEventCase(row);
    setEventAssignees([]);
    try {
      const detail = await fetchFinanceCase(row.id);
      const fromAssign = (detail.assignments || [])
        .filter((a) => a.status !== 'withdrawn')
        .map((a) => ({
          id: a.inspectorId,
          realName: a.inspectorName || a.username || a.inspectorId,
        }));
      const unique = new Map(fromAssign.map((a) => [a.id, a]));
      if (row.inspectorId && !unique.has(row.inspectorId)) {
        unique.set(row.inspectorId, {
          id: row.inspectorId,
          realName: (row.inspectorName || '').split('、')[0] || row.inspectorId,
        });
      }
      const list = [...unique.values()];
      if (!list.length) {
        message.warning('案例尚未派工程师，不能登记事件扣罚');
        setEventCase(undefined);
        return;
      }
      setEventAssignees(list);
    } catch {
      if (!row.inspectorId) {
        message.warning('案例尚未派工程师，不能登记事件扣罚');
        setEventCase(undefined);
        return;
      }
      setEventAssignees([
        {
          id: row.inspectorId,
          realName: (row.inspectorName || '').split('、')[0] || row.inspectorId,
        },
      ]);
    }
  };

  const canAudit = (row: FinanceReviewItem) =>
    row.reviewStatus === 'pending' || row.reviewStatus === 'rejected';

  return (
    <Card className="finance-card" title="结算审核">
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as ReviewTab)}
        items={(Object.keys(tabLabel) as ReviewTab[]).map((key) => ({
          key,
          label: tabLabel[key],
        }))}
      />
      <div className="finance-review-tip">
        {tab === 'pending'
          ? '默认看待审核队列：案例完工后 7 天内完成审核。通过后可到「已通过」页签查看。'
          : tab === 'approved'
            ? '已通过的结算记录不会从系统消失，可按月份/网格继续查询。'
            : tab === 'rejected'
              ? '已驳回记录可在此查看原因；工程师补齐后仍会出现在待审核队列。'
              : '全部状态汇总；仍可用下方筛选缩小范围。网格长仅见本网格案例。'}
      </div>
      <Space className="finance-toolbar" wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          placeholder="案例号/项目/工程师"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ width: 200 }}
        />
        <Input
          type="month"
          value={month || ''}
          onChange={(event) => setMonth(event.target.value || undefined)}
          title="完工月份"
        />
        {isAdmin && (
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
        )}
        {(tab === 'pending' || tab === 'all' || tab === 'rejected') && (
          <Select
            allowClear
            placeholder="超期"
            value={overdue}
            onChange={setOverdue}
            style={{ width: 120 }}
            options={[{ value: 'true', label: '仅超期' }]}
          />
        )}
        <Button type="primary" onClick={load}>
          查询
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1280 }}
        locale={{
          emptyText:
            tab === 'pending'
              ? '暂无待审核记录'
              : tab === 'approved'
                ? '暂无已通过记录'
                : tab === 'rejected'
                  ? '暂无已驳回记录'
                  : '暂无结算审核记录',
        }}
        columns={[
          { title: '案例号', dataIndex: 'gspCaseNo', width: 145 },
          { title: '项目', dataIndex: 'projectName', ellipsis: true },
          {
            title: '工程师',
            dataIndex: 'inspectorName',
            width: 160,
            ellipsis: true,
            render: (v) => v || '-',
          },
          {
            title: '审核状态',
            dataIndex: 'reviewStatus',
            width: 100,
            render: (v) => statusTag(v),
          },
          {
            title: colTip(
              '审核条件',
              '可结算 = 已派工程师，且全部未忽略 PO 条目已配置内部绩效价。与现场照片是否齐全无关。',
            ),
            width: 135,
            render: (_, row) =>
              row.approvalReady ? (
                <Tag color="green">可结算</Tag>
              ) : (
                <Tag color="orange">
                  {!row.inspectorName ? '未派工程师' : `缺绩效价 ${row.missingPerf} 项`}
                </Tag>
              ),
          },
          {
            title: '完工时间',
            dataIndex: 'finishTime',
            width: 160,
            render: (v) => formatDateTime(v),
          },
          ...(tab === 'approved'
            ? [
                {
                  title: '审核时间',
                  dataIndex: 'reviewTime',
                  width: 160,
                  render: (v: string | null | undefined) => formatDateTime(v),
                },
              ]
            : [
                {
                  title: '审核时限',
                  width: 130,
                  render: (_: unknown, row: FinanceReviewItem) =>
                    row.reviewStatus === 'approved' ? (
                      <Tag color="green">已完成</Tag>
                    ) : row.overdue ? (
                      <Tag color="red">已超期</Tag>
                    ) : (
                      <Tag color="gold">剩余 {Math.max(0, row.remainingHours || 0)} 小时</Tag>
                    ),
                },
              ]),
          {
            title: colTip('案例收入', 'Σ(条目数量 × 结算单价)。点操作列「明细」可看条目拆分。'),
            dataIndex: 'caseRevenue',
            width: 110,
            render: (v) => moneyText(v),
          },
          {
            title: colTip('计件绩效', 'Σ(条目数量 × 内部绩效单价)，与案例收入不是同一套价格。点「明细」可看拆分。'),
            dataIndex: 'perfBase',
            width: 110,
            render: (v) => moneyText(v),
          },
          {
            title: colTip('事件扣罚', '本案例已登记的事件扣罚合计。点「明细」可看原因与对象。'),
            dataIndex: 'eventPenalty',
            width: 100,
            render: (v) => moneyText(v),
          },
          {
            title: '操作',
            fixed: 'right' as const,
            width: tab === 'approved' ? 160 : 280,
            render: (_: unknown, row: FinanceReviewItem) => (
              <Space>
                <Button type="link" onClick={() => setAmountCase(row)}>
                  明细
                </Button>
                <Button type="link" onClick={() => openEventPenalty(row)}>
                  事件扣罚
                </Button>
                {canAudit(row) && row.deductionStatus === 'pending' && user?.role === 'super_admin' && (
                  <Button
                    type="link"
                    onClick={async () => {
                      await reviewFinanceDeduction(row.id, true);
                      message.success('历史特殊扣减已复核');
                      await load();
                    }}
                  >
                    复核旧扣减
                  </Button>
                )}
                {canAudit(row) && (
                  <>
                    <Button
                      type="link"
                      danger
                      onClick={() => {
                        setCurrent(row);
                        setAction('reject');
                      }}
                    >
                      驳回
                    </Button>
                    <Button
                      type="primary"
                      disabled={!row.approvalReady || row.deductionStatus === 'pending'}
                      onClick={() => {
                        setCurrent(row);
                        setAction('approve');
                      }}
                    >
                      通过
                    </Button>
                  </>
                )}
                {row.reviewStatus === 'approved' && row.reviewComment && (
                  <Button
                    type="link"
                    onClick={() =>
                      Modal.info({
                        title: '审核意见',
                        content: row.reviewComment,
                      })
                    }
                  >
                    意见
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!action}
        title={action === 'approve' ? '通过结算审核' : '驳回结算审核'}
        okText="确认"
        cancelText="取消"
        onCancel={() => {
          setAction(undefined);
          setCurrent(undefined);
          form.resetFields();
        }}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          {action === 'reject' && (
            <Form.Item name="reason" label="原因" rules={[{ required: true, message: '请填写原因' }]}>
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          )}
          {action === 'approve' && (
            <Form.Item name="comment" label="审核意见（可选）">
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
        </Form>
      </Modal>
      {eventCase && eventAssignees.length > 0 && (
        <AssessmentEventDrawer
          open={!!eventCase}
          onClose={() => {
            setEventCase(undefined);
            setEventAssignees([]);
          }}
          month={
            eventCase.finishTime
              ? dayjs(eventCase.finishTime).format('YYYY-MM')
              : dayjs().format('YYYY-MM')
          }
          assignees={eventAssignees}
          serviceCaseId={eventCase.id}
          caseLabel={eventCase.gspCaseNo}
          onChanged={() => void load()}
        />
      )}
      <SettlementAmountDrawer
        open={!!amountCase}
        caseId={amountCase?.id}
        caseLabel={amountCase ? `${amountCase.gspCaseNo} ${amountCase.projectName}` : undefined}
        onClose={() => setAmountCase(undefined)}
      />
    </Card>
  );
}
