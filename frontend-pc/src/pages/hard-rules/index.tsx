import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { EditOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchHardRules,
  updateHardRule,
  resetHardRule,
  type HardRuleItem,
  type HardRuleEnforceMode,
  type HardRuleMatchMode,
} from '../../api/hard-rule';

const MATCH_MODE_LABEL: Record<string, string> = {
  title_exact: '标题精确匹配',
  title_includes: '标题包含',
  criteria_includes: '名称+说明包含',
};

const ENFORCE_MODE_LABEL: Record<string, string> = {
  strict: '严格（提示词+二次复核）',
  normal: '标准（仅提示词/主校验）',
  off: '关闭（不插硬规则）',
};

/** 超管：AI 专项硬规则配置 */
export default function HardRulesPage() {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<HardRuleItem[]>([]);
  const [editing, setEditing] = useState<HardRuleItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await fetchHardRules());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (row: HardRuleItem) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      matchMode: row.matchMode,
      matchPattern: row.matchPattern,
      promptText: row.promptText,
      jsonSchemaHint: row.jsonSchemaHint || '',
      enabled: row.enabled,
      enforceMode: row.enforceMode,
      changeNote: '',
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await updateHardRule(editing.code, {
        name: values.name,
        matchMode: values.matchMode as HardRuleMatchMode,
        matchPattern: values.matchPattern,
        promptText: values.promptText,
        jsonSchemaHint: values.jsonSchemaHint || null,
        enabled: values.enabled,
        enforceMode: values.enforceMode as HardRuleEnforceMode,
        changeNote: values.changeNote,
      });
      message.success('硬规则已保存，新分析将使用新版本');
      setEditing(null);
      await load();
    } catch {
      /* validate / interceptor */
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (row: HardRuleItem) => {
    try {
      await resetHardRule(row.code, `恢复 ${row.code} 内置默认`);
      message.success('已恢复内置默认硬规则');
      await load();
    } catch {
      /* interceptor */
    }
  };

  const columns: ColumnsType<HardRuleItem> = [
    {
      title: '编码',
      dataIndex: 'code',
      width: 130,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '匹配',
      width: 220,
      render: (_, row) => (
        <span>
          {MATCH_MODE_LABEL[row.matchMode] || row.matchMode}
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.matchPattern}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) =>
        row.enabled ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '校验强度',
      dataIndex: 'enforceMode',
      width: 180,
      render: (v: string) => ENFORCE_MODE_LABEL[v] || v,
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 80,
      render: (v: number) => `v${v}`,
    },
    {
      title: '最近变更',
      dataIndex: 'changeNote',
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="恢复内置默认？"
            description="将覆盖当前提示词与匹配配置"
            onConfirm={() => void handleReset(row)}
          >
            <Button type="link" icon={<ReloadOutlined />}>
              恢复默认
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="AI 硬规则"
        extra={
          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          仅超级管理员可配置。硬规则会插入视觉模型提示词，并控制二次复核强度；与「服务类型」里的检查说明互补——说明给人看，硬规则负责系统强制判定。
          修改后对新发起的分析立即生效（不改历史结论）。
        </Typography.Paragraph>
        <Table
          rowKey="code"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={false}
          scroll={{ x: 1100 }}
        />
      </Card>

      <Modal
        title={editing ? `编辑硬规则 · ${editing.code}` : '编辑硬规则'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        width={860}
        destroyOnClose
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={64} />
          </Form.Item>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item
              name="matchMode"
              label="匹配方式"
              rules={[{ required: true }]}
              style={{ flex: 1, minWidth: 220 }}
            >
              <Select
                options={[
                  { value: 'title_exact', label: '标题精确匹配' },
                  { value: 'title_includes', label: '标题包含' },
                  { value: 'criteria_includes', label: '名称+说明包含' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="matchPattern"
              label="匹配关键词（| 分隔）"
              rules={[{ required: true, message: '请输入匹配关键词' }]}
              style={{ flex: 2, minWidth: 280 }}
            >
              <Input placeholder="例如：交流侧 或 接地安装检查|接地检查" />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
            <Form.Item name="enforceMode" label="校验强度" rules={[{ required: true }]}>
              <Select
                style={{ width: 280 }}
                options={[
                  { value: 'strict', label: '严格（提示词+二次复核）' },
                  { value: 'normal', label: '标准（仅提示词/主校验）' },
                  { value: 'off', label: '关闭（不插硬规则）' },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item
            name="promptText"
            label="硬规则正文（插入模型提示词）"
            rules={[{ required: true, min: 10, message: '请填写硬规则正文' }]}
          >
            <Input.TextArea rows={14} style={{ fontFamily: 'ui-monospace, monospace' }} />
          </Form.Item>
          <Form.Item name="jsonSchemaHint" label="JSON Schema 说明（可选，供对照）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="changeNote"
            label="变更说明"
            rules={[{ required: true, min: 2, message: '请填写本次改动说明' }]}
          >
            <Input placeholder="例如：加强空PE端子否决" maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
