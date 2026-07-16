import { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Table, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { fetchAdminDashboard, fetchSiteDashboard, type DashboardData } from '../../api/stats';
import { fetchAlerts } from '../../api/alert';
import { useAuthStore } from '../../stores/auth';
import SiteMapView from '../../components/SiteMapView';
import './dashboard.css';
import { DEVICE_TYPE_LABEL } from '../../types';

/** 仪表盘：统计卡片 + 趋势图 + 待审列表 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'super_admin';
  const [data, setData] = useState<DashboardData | null>(null);
  const [openAlerts, setOpenAlerts] = useState(0);

  useEffect(() => {
    const load = isAdmin ? fetchAdminDashboard : fetchSiteDashboard;
    load().then(setData).catch(() => undefined);
    fetchAlerts({ status: 'open', limit: 1, page: 1 })
      .then((res) => setOpenAlerts(res.total))
      .catch(() => undefined);
  }, [isAdmin]);

  const trendOption = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['新建任务', '完成审核'] },
    xAxis: { type: 'category' as const, data: data?.trend.map((t) => t.date.slice(5)) || [] },
    yAxis: { type: 'value' as const },
    series: [
      {
        name: '新建任务',
        type: 'line' as const,
        smooth: true,
        data: data?.trend.map((t) => t.created) || [],
        itemStyle: { color: '#2bb673' },
      },
      {
        name: '完成审核',
        type: 'line' as const,
        smooth: true,
        data: data?.trend.map((t) => t.approved) || [],
        itemStyle: { color: '#1890ff' },
      },
    ],
  };

  const taskPieOption = {
    tooltip: { trigger: 'item' as const },
    series: [
      {
        type: 'pie' as const,
        radius: ['40%', '70%'],
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

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome">
        <div>
          <div className="dashboard-welcome__eyebrow">运营概览</div>
          <h2>{new Date().getHours() < 12 ? '早上好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}，{user?.realName || '管理员'}</h2>
          <p>今日站点巡检与设备运行情况已为你汇总。</p>
        </div>
        <div className="dashboard-welcome__date">
          <b>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</b>
          <span>{new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}</span>
        </div>
      </div>
      <Row className="dashboard-stats" gutter={[14, 14]}>
        {isAdmin && (
          <Col xs={12} sm={8} lg={4}>
            <Card><Statistic title="站点数" value={data?.sites ?? '-'} /></Card>
          </Col>
        )}
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="设备数" value={data?.devices ?? '-'} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="任务总数" value={data?.tasks.total ?? '-'} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="待审核"
              value={data?.pendingAudit ?? '-'}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="已通过"
              value={data?.tasks.approved ?? '-'}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="巡检记录" value={data?.records.total ?? '-'} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card
            hoverable
            onClick={() => navigate('/alerts')}
            style={{ cursor: 'pointer' }}
          >
            <Statistic
              title="未处理预警"
              value={openAlerts}
              valueStyle={{ color: openAlerts > 0 ? '#ff4d4f' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Row className="dashboard-grid" gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="站点分布地图">
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
        <Col xs={24} lg={14}>
          <Card title="任务状态分布">
            <ReactECharts option={taskPieOption} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="待审核报告" extra={
            <Button type="link" onClick={() => navigate('/audit')}>
              前往审核
            </Button>
          }>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.recentPending || []}
              scroll={{ x: 'max-content' }}
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
                  width: 140,
                  render: (v?: string) => (v ? new Date(v).toLocaleString() : '-'),
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
