import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Statistic, Table, Button, Space } from 'antd';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { fetchAdminDashboard, fetchSiteDashboard, type DashboardData } from '../../api/stats';
import { useAuthStore } from '../../stores/auth';
import SiteMapView from '../../components/SiteMapView';
import './dashboard.css';
import { DEVICE_TYPE_LABEL } from '../../types';
import { formatDateTime } from '../../utils/displayLabels';

type StatItem = {
  key: string;
  title: string;
  value: number | string;
  color?: string;
  path?: string;
};

/** 巡检仪表盘：现场运营总览，与费用「经营看板」互补 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'super_admin';
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    const load = isAdmin ? fetchAdminDashboard : fetchSiteDashboard;
    load().then(setData).catch(() => undefined);
  }, [isAdmin]);

  const stats = useMemo<StatItem[]>(() => {
    const items: StatItem[] = [];
    if (isAdmin) {
      items.push({ key: 'sites', title: '网格数', value: data?.sites ?? '-', path: '/sites' });
    }
    items.push(
      { key: 'devices', title: '设备数', value: data?.devices ?? '-', path: '/sites' },
      { key: 'tasks', title: '任务总数', value: data?.tasks.total ?? '-', path: '/records' },
      {
        key: 'pending',
        title: '待审核',
        value: data?.pendingAudit ?? '-',
        color: '#c47a12',
        path: '/audit',
      },
      {
        key: 'approved',
        title: '已通过',
        value: data?.tasks.approved ?? '-',
        color: '#1a8f5c',
        path: '/records',
      },
      {
        key: 'records',
        title: '巡检记录',
        value: data?.records.total ?? '-',
        path: '/records',
      },
    );
    return items;
  }, [data, isAdmin]);

  const createdTrend = data?.trend.map((t) => t.created) || [];
  const approvedTrend = data?.trend.map((t) => t.approved) || [];
  const trendPeak = Math.max(0, ...createdTrend, ...approvedTrend);

  const trendOption = {
    tooltip: {
      trigger: 'axis' as const,
      confine: true,
      // 数据贴底时默认 tip 会压在 X 轴/日期上，固定偏上展示
      position: (
        point: number[],
        _params: unknown,
        _dom: unknown,
        _rect: unknown,
        size: { contentSize: number[]; viewSize: number[] },
      ) => {
        const tipW = size.contentSize[0] || 120;
        const tipH = size.contentSize[1] || 56;
        let x = point[0] - tipW / 2;
        x = Math.min(Math.max(x, 8), size.viewSize[0] - tipW - 8);
        // 优先在点上方；贴底时也强制离开 X 轴与日期文字
        let y = point[1] - tipH - 14;
        if (y < 8) y = Math.min(point[1] + 14, size.viewSize[1] - tipH - 40);
        y = Math.min(Math.max(y, 8), size.viewSize[1] - tipH - 40);
        return [x, y];
      },
    },
    legend: {
      data: ['新建任务', '完成审核'],
      top: 4,
      left: 'center',
      itemGap: 28,
      icon: 'circle',
    },
    grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category' as const,
      boundaryGap: false,
      data: data?.trend.map((t) => t.date.slice(5)) || [],
      axisTick: { alignWithLabel: true },
      axisLabel: { margin: 12, color: '#6a7f76' },
      axisLine: { lineStyle: { color: 'rgba(23,72,54,.18)' } },
    },
    yAxis: {
      type: 'value' as const,
      min: 0,
      minInterval: 1,
      // 峰值很小时抬高刻度，避免折线/圆点整条压在 X 轴上
      max: Math.max(4, Math.ceil(trendPeak * 1.35) || 4),
      splitLine: { lineStyle: { color: 'rgba(23,72,54,.08)', type: 'dashed' as const } },
      axisLabel: { color: '#6a7f76' },
    },
    series: [
      {
        name: '新建任务',
        type: 'line' as const,
        smooth: true,
        data: createdTrend,
        showSymbol: true,
        symbolSize: 8,
        label: { show: false },
        itemStyle: { color: '#2bb673' },
        lineStyle: { width: 2.5 },
        areaStyle: { color: 'rgba(43,182,115,.08)' },
      },
      {
        name: '完成审核',
        type: 'line' as const,
        smooth: true,
        data: approvedTrend,
        showSymbol: true,
        symbolSize: 8,
        label: { show: false },
        itemStyle: { color: '#3d7ea6' },
        lineStyle: { width: 2.5 },
      },
    ],
  };

  const taskPieOption = {
    tooltip: { trigger: 'item' as const },
    legend: { bottom: 0, icon: 'circle' },
    series: [
      {
        type: 'pie' as const,
        radius: ['42%', '68%'],
        center: ['50%', '46%'],
        data: data
          ? [
              { name: '待办', value: data.tasks.pending },
              { name: '进行中', value: data.tasks.inProgress },
              { name: '待审核', value: data.tasks.submitted },
              { name: '已通过', value: data.tasks.approved },
              { name: '已驳回', value: data.tasks.rejected },
            ].filter((d) => d.value > 0)
          : [],
      },
    ],
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome">
        <div>
          <div className="dashboard-welcome__eyebrow">仪表盘</div>
          <h2>
            {greeting}，{user?.realName || '管理员'}
          </h2>
          <p>现场作业与质量总览。派工、结算请走侧栏「费用结算」。网格长可审本网格验图；结算审核仅管理员。</p>
          <Space wrap className="dashboard-welcome__actions">
            <Button type="primary" onClick={() => navigate('/finance/cases')}>
              案例管理
            </Button>
            {isAdmin && (
              <Button onClick={() => navigate('/finance/dashboard')}>经营看板</Button>
            )}
            <Button onClick={() => navigate('/audit')}>验图审核</Button>
            <Button onClick={() => navigate('/analysis')}>数据分析</Button>
          </Space>
        </div>
        <div className="dashboard-welcome__date">
          <b>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</b>
          <span>{new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}</span>
        </div>
      </div>

      <div className="dashboard-stats" style={{ ['--stat-count' as string]: String(stats.length) }}>
        {stats.map((item) => (
          <Card
            key={item.key}
            className={item.path ? 'dashboard-stat-card is-clickable' : 'dashboard-stat-card'}
            onClick={item.path ? () => navigate(item.path!) : undefined}
          >
            <Statistic
              title={item.title}
              value={item.value}
              valueStyle={item.color ? { color: item.color } : undefined}
            />
          </Card>
        ))}
      </div>

      <Row className="dashboard-grid" gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="网格分布">
            <SiteMapView markers={data?.siteMarkers || []} />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="近 7 日任务趋势">
            <ReactECharts option={trendOption} style={{ height: 320 }} />
          </Card>
        </Col>
      </Row>

      <Row className="dashboard-grid" gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="任务状态分布">
            <ReactECharts option={taskPieOption} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card
            title="待审核报告"
            extra={
              <Button type="link" onClick={() => navigate('/audit')}>
                前往审核
              </Button>
            }
          >
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.recentPending || []}
              scroll={{ x: 'max-content' }}
              onRow={() => ({
                onClick: () => navigate('/audit'),
                style: { cursor: 'pointer' },
              })}
              columns={[
                { title: '任务', dataIndex: 'taskName', render: (v) => v || '-' },
                {
                  title: '设备类型',
                  dataIndex: 'deviceType',
                  width: 120,
                  render: (value: string) =>
                    DEVICE_TYPE_LABEL[value as keyof typeof DEVICE_TYPE_LABEL] || '未知设备类型',
                },
                {
                  title: '提交时间',
                  dataIndex: 'submittedAt',
                  width: 160,
                  render: (v?: string) => formatDateTime(v),
                },
              ]}
              locale={{ emptyText: '暂无待审核报告' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
