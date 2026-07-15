import { useEffect, useState } from 'react';
import { Card, Col, Row, Select, DatePicker, Space, Button, Input } from 'antd';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import {
  fetchCompletionStats,
  fetchDefectStats,
  type CompletionStats,
  type DefectStats,
} from '../../api/stats';
import { fetchSites, fetchSiteMembers } from '../../api/site';
import { DEVICE_TYPE_LABEL } from '../../types';
import type { SiteItem } from '../../types';

/** 数据分析：完成率、缺陷分布、工程师排名 */
export default function AnalysisPage() {
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [siteId, setSiteId] = useState<string>();
  const [region, setRegion] = useState('');
  const [deviceType, setDeviceType] = useState<string>();
  const [inspectorId, setInspectorId] = useState<string>();
  const [inspectors, setInspectors] = useState<Array<{ value: string; label: string }>>([]);
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [completion, setCompletion] = useState<CompletionStats | null>(null);
  const [defects, setDefects] = useState<DefectStats | null>(null);

  useEffect(() => {
    fetchSites({ limit: 100 }).then((res) => setSites(res.list));
  }, []);

  useEffect(() => {
    if (!siteId) {
      setInspectors([]);
      setInspectorId(undefined);
      return;
    }
    fetchSiteMembers(siteId, 'inspector').then((members) => {
      setInspectors(
        members
          .filter((m) => m.user)
          .map((m) => ({ value: m.userId, label: m.user!.realName })),
      );
    });
  }, [siteId]);

  const load = async () => {
    const params = {
      siteId,
      startDate: range?.[0]?.format('YYYY-MM-DD'),
      endDate: range?.[1]?.format('YYYY-MM-DD'),
      region: region.trim() || undefined,
      deviceType,
      inspectorId,
    };
    const [c, d] = await Promise.all([
      fetchCompletionStats(params),
      fetchDefectStats(params),
    ]);
    setCompletion(c);
    setDefects(d);
  };

  useEffect(() => {
    Promise.all([fetchCompletionStats({}), fetchDefectStats({})])
      .then(([c, d]) => {
        setCompletion(c);
        setDefects(d);
      })
      .catch(() => undefined);
  }, []);

  const completionOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const,
      data: completion?.byDate.map((d) => d.date.slice(5)) || [],
    },
    yAxis: { type: 'value' as const },
    series: [
      {
        name: '任务数',
        type: 'bar' as const,
        data: completion?.byDate.map((d) => d.total) || [],
        itemStyle: { color: '#91d5ff' },
      },
      {
        name: '已完成',
        type: 'bar' as const,
        data: completion?.byDate.map((d) => d.completed) || [],
        itemStyle: { color: '#2bb673' },
      },
    ],
  };

  const defectHeatOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const,
      data: defects?.byEntry.map((e) => e.name) || [],
      axisLabel: { rotate: 30, interval: 0 },
    },
    yAxis: { type: 'value' as const, name: '不合格次数' },
    series: [
      {
        type: 'bar' as const,
        data: defects?.byEntry.map((e) => e.failCount) || [],
        itemStyle: {
          color: (params: { dataIndex: number }) =>
            ['#ff7875', '#ffa940', '#ffc53d', '#ff9c6e'][params.dataIndex % 4],
        },
      },
    ],
  };

  const deviceTypeOption = {
    tooltip: { trigger: 'item' as const },
    series: [
      {
        type: 'pie' as const,
        radius: '65%',
        data:
          defects?.byDeviceType.map((d) => ({
            name: DEVICE_TYPE_LABEL[d.deviceType as keyof typeof DEVICE_TYPE_LABEL] || d.deviceType,
            value: d.fail,
          })) || [],
      },
    ],
  };

  const rankOption = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 100 },
    xAxis: { type: 'value' as const, max: 100, name: '合格率%' },
    yAxis: {
      type: 'category' as const,
      data: defects?.inspectorRanking.slice(0, 8).map((r) => r.realName) || [],
    },
    series: [
      {
        type: 'bar' as const,
        data: defects?.inspectorRanking.slice(0, 8).map((r) => r.passRate) || [],
        itemStyle: { color: '#2bb673' },
        label: { show: true, position: 'right' as const, formatter: '{c}%' },
      },
    ],
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          placeholder="区域（省/市/现场）"
          style={{ width: 160 }}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        />
        <Select
          allowClear
          placeholder="站点"
          style={{ width: 180 }}
          value={siteId}
          onChange={setSiteId}
          options={sites.map((s) => ({ label: s.name, value: s.id }))}
        />
        <Select
          allowClear
          placeholder="设备类型"
          style={{ width: 150 }}
          value={deviceType}
          onChange={setDeviceType}
          options={Object.entries(DEVICE_TYPE_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Select
          allowClear
          placeholder="巡检员"
          style={{ width: 120 }}
          value={inspectorId}
          onChange={setInspectorId}
          disabled={!siteId}
          options={inspectors}
        />
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as typeof range)} />
        <Button type="primary" onClick={() => void load()}>
          查询
        </Button>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card title="任务完成率">
            <div style={{ fontSize: 36, fontWeight: 700, color: '#2bb673' }}>
              {completion?.completionRate ?? 0}%
            </div>
            <div style={{ color: '#888', marginTop: 8 }}>
              {completion?.completedTasks ?? 0} / {completion?.totalTasks ?? 0} 任务已完成
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="条目不合格率">
            <div style={{ fontSize: 36, fontWeight: 700, color: '#ff4d4f' }}>
              {defects?.failRate ?? 0}%
            </div>
            <div style={{ color: '#888', marginTop: 8 }}>
              {defects?.failCount ?? 0} / {defects?.totalEntries ?? 0} 检查项不合格
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="巡检报告数">
            <div style={{ fontSize: 36, fontWeight: 700 }}>{defects?.totalInspections ?? 0}</div>
            <div style={{ color: '#888', marginTop: 8 }}>已提交/已审核记录</div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="任务完成趋势">
            <ReactECharts option={completionOption} style={{ height: 300 }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="不合格条目分布（高频环节）">
            <ReactECharts option={defectHeatOption} style={{ height: 300 }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="设备类型缺陷分布">
            <ReactECharts option={deviceTypeOption} style={{ height: 300 }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="巡检员合格率排名">
            <ReactECharts option={rankOption} style={{ height: 300 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
