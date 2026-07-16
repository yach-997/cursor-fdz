import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchAlerts,
  fetchAlertConfigs,
  saveAlertConfig,
  resolveAlert,
  type AlertItem,
} from '../../api/alert';
import { fetchSites } from '../../api/site';
import type { SiteItem } from '../../types';
import { useNavigate } from 'react-router-dom';
import { ALERT_SEVERITY_LABEL } from '../../utils/displayLabels';

const TYPE_LABEL: Record<string, string> = {
  high_fail_rate: '合格率预警',
  overdue_task: '任务超期',
  pending_audit: '待审积压',
  data_archived: '数据归档',
};

const SEV_COLOR: Record<string, string> = {
  info: 'blue',
  warning: 'orange',
  critical: 'red',
};

const METADATA_LABEL: Record<string, string> = {
  passRate: '合格率',
  passRateThreshold: '合格率阈值',
  failRate: '不合格率',
  total: '检查项总数',
  fail: '不合格数',
  count: '数量',
  overdueDays: '超期天数',
  aiErrorCount: '智能分析失败数',
  recordIds: '关联巡检记录',
  subtype: '预警子类型',
};

function metadataValue(key: string, value: unknown) {
  if (key === 'subtype' && value === 'ai_failure') return '智能分析持续失败';
  if (['passRate', 'passRateThreshold', 'failRate'].includes(key)) {
    return `${Number(value || 0).toFixed(1)}%`;
  }
  if (Array.isArray(value)) return `${value.length} 条记录`;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value ?? '-');
}

/** 预警中心：阈值配置 + 预警记录 */
export default function AlertsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('open');
  const [siteId, setSiteId] = useState<string>();
  const [sites, setSites] = useState<SiteItem[]>([]);

  const [configOpen, setConfigOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchSites({ limit: 100, status: 'active' }).then((res) => setSites(res.list));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAlerts({ page, limit: 10, status, siteId });
      setData(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, status, siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const openConfig = async (sid?: string) => {
    form.resetFields();
    if (sid) {
      const configs = await fetchAlertConfigs(sid);
      const cfg = configs[0];
      form.setFieldsValue({
        siteId: sid,
        passRateThreshold: cfg?.passRateThreshold ?? 75,
        overdueDays: cfg?.overdueDays ?? 3,
        enabled: cfg?.enabled ?? true,
        notifyEmails: cfg?.notifyEmails || [],
        webhookUrl: cfg?.webhookUrl || '',
      });
    }
    setConfigOpen(true);
  };

  const handleSaveConfig = async () => {
    const values = await form.validateFields();
    await saveAlertConfig(values);
    message.success('阈值配置已保存');
    setConfigOpen(false);
    load();
  };

  const columns: ColumnsType<AlertItem> = [
    { title: '站点', dataIndex: 'siteName', width: 140 },
    {
      title: '类型',
      dataIndex: 'alertType',
      width: 130,
      render: (v: string) => TYPE_LABEL[v] || '其他预警',
    },
    { title: '标题', dataIndex: 'title' },
    {
      title: '级别',
      dataIndex: 'severity',
      width: 90,
      render: (v: string) => (
        <Tag color={SEV_COLOR[v] || 'default'}>{ALERT_SEVERITY_LABEL[v] || '未知级别'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => (
        <Tag color={v === 'open' ? 'processing' : 'success'}>
          {v === 'open' ? '未处理' : '已处理'}
        </Tag>
      ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '操作',
      width: 100,
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" onClick={() => navigate(`/records?siteId=${row.siteId}`)}>
            查看明细
          </Button>
          {row.status === 'open' && (
            <Button
              type="link"
              onClick={async () => {
                await resolveAlert(row.id);
                message.success('已标记处理');
                load();
              }}
            >
              处理
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={24}>
          <Card size="small" title="预警说明">
            系统每小时自动扫描：合格率低于阈值、任务超期、待审积压；巡检记录和照片至少保留 3 个月，超期后仅归档、不删除。
          </Card>
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="站点"
          style={{ width: 180 }}
          value={siteId}
          onChange={setSiteId}
          options={sites.map((s) => ({ label: s.name, value: s.id }))}
        />
        <Select
          style={{ width: 120 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { label: '未处理', value: 'open' },
            { label: '已处理', value: 'resolved' },
          ]}
        />
        <Button type="primary" onClick={() => openConfig(siteId)}>
          阈值配置
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowRender: (row) => (
            <div style={{ color: '#666' }}>
              {row.message}
              {row.metadata ? (
                <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 12 }}>
                  {Object.entries(row.metadata).map(([key, value]) => (
                    <div key={key}>
                      <b>{METADATA_LABEL[key] || '补充信息'}：</b>{metadataValue(key, value)}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        }}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
      />

      <Modal
        title="预警阈值配置"
        open={configOpen}
        onOk={() => void handleSaveConfig()}
        onCancel={() => setConfigOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="siteId" label="站点" rules={[{ required: true }]}>
            <Select
              placeholder="选择站点"
              options={sites.map((s) => ({ label: s.name, value: s.id }))}
            />
          </Form.Item>
          <Form.Item
            name="passRateThreshold"
            label="合格率预警阈值 (%)"
            tooltip="近30天合格率低于该数值时触发预警"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={99} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="overdueDays" label="任务超期天数" rules={[{ required: true }]}>
            <InputNumber min={1} max={90} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用预警" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notifyEmails" label="运维人员 / 站点联系人邮箱（回车添加）">
            <Select mode="tags" placeholder="admin@example.com" tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Form.Item name="webhookUrl" label="机器人通知地址">
            <Input placeholder="填写企业微信或钉钉机器人的通知地址" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
