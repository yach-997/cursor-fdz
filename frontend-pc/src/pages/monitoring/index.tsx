import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, Descriptions, Row, Space, Spin, Tag, Timeline } from 'antd';
import { CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { fetchSystemStatus, type SystemStatus } from '../../api/system';

const statusMeta = {
  healthy: { color: 'success', text: '运行正常', icon: <CheckCircleOutlined /> },
  warning: { color: 'warning', text: '需要关注', icon: <ExclamationCircleOutlined /> },
  error: { color: 'error', text: '服务异常', icon: <CloseCircleOutlined /> },
} as const;

export default function MonitoringPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SystemStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchSystemStatus());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!data && loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!data) return <Card><Button onClick={() => void load()}>重新检测</Button></Card>;

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `系统运行状态报告_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Tag color={statusMeta[data.overall].color} icon={statusMeta[data.overall].icon}>
              {statusMeta[data.overall].text}
            </Tag>
            <span>最近检测：{new Date(data.checkedAt).toLocaleString()}</span>
          </Space>
          <Space>
            <Button onClick={downloadReport}>导出状态报告</Button>
            <Button loading={loading} onClick={() => void load()}>立即检测</Button>
          </Space>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {data.services.map((service) => {
          const meta = statusMeta[service.status];
          return (
            <Col xs={24} sm={12} xl={8} key={service.key}>
              <Card title={service.name} extra={<Tag color={meta.color}>{meta.text}</Tag>}>
                <div style={{ minHeight: 44, color: '#667085', lineHeight: 1.7 }}>{service.detail}</div>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="监控与数据保障">
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="监控周期">{data.metrics.monitoring}</Descriptions.Item>
              <Descriptions.Item label="近24小时 AI 失败">{data.metrics.aiFailures24h} 个条目</Descriptions.Item>
              <Descriptions.Item label="数据保留">不少于 {data.metrics.dataRetentionMonths} 个月</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="运维服务保障">
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="服务期限">{data.support.servicePeriod}</Descriptions.Item>
              <Descriptions.Item label="工作日响应">不超过 {data.support.workdayResponseHours} 小时</Descriptions.Item>
              <Descriptions.Item label="非工作日重大故障">不超过 {data.support.holidayMajorResponseHours} 小时</Descriptions.Item>
            </Descriptions>
            <Timeline
              style={{ marginTop: 20 }}
              items={data.support.scope.map((item) => ({ color: 'green', children: item }))}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
