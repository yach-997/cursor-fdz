import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Collapse,
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
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchHardRules,
  createHardRule,
  updateHardRule,
  deleteHardRule,
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
  strict: '严格（提示词加严）',
  normal: '标准（仅提示词）',
  off: '关闭（不插硬规则）',
};

type EditorMode = 'create' | 'edit';

/** 超管：AI 硬规则配置（可自建通用规则） */
export default function HardRulesPage() {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<HardRuleItem[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('create');
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

  const openCreate = () => {
    setEditorMode('create');
    setEditing(null);
    form.setFieldsValue({
      name: '',
      matchMode: 'criteria_includes',
      matchPattern: '',
      passCriteria: '',
      failCriteria: '',
      promptText: '',
      jsonSchemaHint: '',
      enabled: true,
      enforceMode: 'strict',
      changeNote: '新建自定义硬规则',
    });
    setEditorOpen(true);
  };

  const openEdit = (row: HardRuleItem) => {
    setEditorMode('edit');
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      matchMode: row.matchMode,
      matchPattern: row.matchPattern,
      passCriteria: '',
      failCriteria: '',
      promptText: row.promptText,
      jsonSchemaHint: row.jsonSchemaHint || '',
      enabled: row.enabled,
      enforceMode: row.enforceMode,
      changeNote: '',
    });
    setEditorOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const matchMode = values.matchMode as HardRuleMatchMode;
      const enforceMode = values.enforceMode as HardRuleEnforceMode;
      const pass = String(values.passCriteria || '').trim();
      const fail = String(values.failCriteria || '').trim();
      const promptText = String(values.promptText || '').trim();

      if (editorMode === 'create') {
        if (!pass && !fail && !promptText) {
          message.error('请填写合格标准、不合格标准，或在高级选项填写完整正文');
          return;
        }
        await createHardRule({
          name: values.name,
          matchMode,
          matchPattern: values.matchPattern,
          passCriteria: pass || undefined,
          failCriteria: fail || undefined,
          promptText: promptText || undefined,
          jsonSchemaHint: values.jsonSchemaHint || null,
          enabled: values.enabled,
          enforceMode,
          changeNote: values.changeNote || '新建自定义硬规则',
        });
        message.success('已新增规则，新分析将自动匹配');
      } else if (editing) {
        const payload: Parameters<typeof updateHardRule>[1] = {
          name: values.name,
          matchMode,
          matchPattern: values.matchPattern,
          enabled: values.enabled,
          enforceMode,
          changeNote: values.changeNote || '更新硬规则',
          jsonSchemaHint: values.jsonSchemaHint || null,
        };
        // 新建习惯：填合格/不合格时优先合成；否则用正文
        if (pass || fail) {
          payload.passCriteria = pass || undefined;
          payload.failCriteria = fail || undefined;
        } else {
          payload.promptText = promptText;
        }
        await updateHardRule(editing.code, payload);
        message.success('硬规则已保存，新分析将使用新版本');
      }
      setEditorOpen(false);
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

  const handleDelete = async (row: HardRuleItem) => {
    try {
      await deleteHardRule(row.code);
      message.success('已删除自定义规则');
      await load();
    } catch {
      /* interceptor */
    }
  };

  const columns: ColumnsType<HardRuleItem> = [
    {
      title: '类型',
      width: 100,
      render: (_, row) =>
        row.builtin ? <Tag color="blue">系统内置</Tag> : <Tag color="purple">自定义</Tag>,
    },
    {
      title: '编码',
      dataIndex: 'code',
      width: 140,
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
      width: 90,
      render: (_, row) =>
        row.enabled ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '校验强度',
      dataIndex: 'enforceMode',
      width: 160,
      render: (v: string) => ENFORCE_MODE_LABEL[v] || v,
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 70,
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
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {row.builtin ? (
            <Popconfirm
              title="恢复内置默认？"
              description="将覆盖当前提示词与匹配配置"
              onConfirm={() => void handleReset(row)}
            >
              <Button type="link" icon={<ReloadOutlined />}>
                恢复默认
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              title="删除这条自定义规则？"
              description="删除后新分析不再匹配该规则"
              onConfirm={() => void handleDelete(row)}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="AI 硬规则"
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增规则
            </Button>
            <Button onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          <strong>怎么用（三步）：</strong>
          ① 服务类型里检查项名称带上关键词（如「XX铭牌检查」）；
          ② 点「新增规则」，填关键词 + 合格/不合格标准；
          ③ 工程师拍该检查项时自动套用。改规则只影响<strong>新发起的分析</strong>。
          系统内置 6 条保留专项能力（最少张数等）；自定义规则走通用提示词判定。
        </Typography.Paragraph>
        <Table
          rowKey="code"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={false}
          scroll={{ x: 1200 }}
        />
      </Card>

      <Modal
        title={
          editorMode === 'create'
            ? '新增 AI 规则'
            : `编辑硬规则 · ${editing?.code || ''}`
        }
        open={editorOpen}
        onCancel={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        width={720}
        destroyOnClose
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="规则名称"
            rules={[{ required: true, message: '请输入名称' }]}
            extra="给管理员看的名字，例如「铭牌清晰度检查」"
          >
            <Input maxLength={64} placeholder="例如：铭牌清晰度检查" />
          </Form.Item>
          <Form.Item
            name="matchPattern"
            label="匹配关键词"
            rules={[{ required: true, message: '请输入匹配关键词' }]}
            extra="检查项名称或说明里包含这些词就会套用。多个词用 | 分隔，如：铭牌|序列号"
          >
            <Input placeholder="例如：铭牌|序列号" />
          </Form.Item>

          {editorMode === 'create' || !editing?.builtin ? (
            <>
              <Form.Item
                name="passCriteria"
                label="合格标准"
                extra="用白话写：什么情况算合格"
              >
                <Input.TextArea rows={4} placeholder="例如：铭牌文字清晰可读，序列号完整无遮挡" />
              </Form.Item>
              <Form.Item
                name="failCriteria"
                label="不合格标准（必须判不合格）"
                extra="用白话写：什么情况必须 fail"
              >
                <Input.TextArea
                  rows={4}
                  placeholder="例如：模糊、反光看不清、序号被挡、只拍到局部"
                />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="promptText"
              label="硬规则正文"
              rules={[{ required: true, min: 10, message: '请填写硬规则正文' }]}
            >
              <Input.TextArea rows={12} style={{ fontFamily: 'ui-monospace, monospace' }} />
            </Form.Item>
          )}

          <Space size="large" wrap>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
            <Form.Item
              name="enforceMode"
              label="校验强度"
              rules={[{ required: true }]}
              extra="自定义规则只有提示词，没有接地/交直流那种专项二次复核。「严格」只是把提示词写得更严（拿不准必须不合格）。内置专项在严格模式下才会再跑二次复核。"
            >
              <Select
                style={{ width: 280 }}
                options={[
                  { value: 'strict', label: '严格（提示词加严；内置专项另有二次复核）' },
                  { value: 'normal', label: '标准（仅提示词）' },
                  { value: 'off', label: '关闭（不插硬规则）' },
                ]}
              />
            </Form.Item>
          </Space>

          <Form.Item
            name="changeNote"
            label="变更说明"
            rules={[{ required: true, min: 2, message: '请填写本次改动说明' }]}
          >
            <Input placeholder="例如：新增铭牌检查规则" maxLength={500} />
          </Form.Item>

          <Collapse
            ghost
            items={[
              {
                key: 'advanced',
                label: '高级选项（一般不用改）',
                children: (
                  <>
                    <Form.Item
                      name="matchMode"
                      label="匹配方式"
                      rules={[{ required: true }]}
                      extra="默认「名称+说明包含」即可"
                    >
                      <Select
                        options={[
                          { value: 'criteria_includes', label: '名称+说明包含' },
                          { value: 'title_includes', label: '仅标题包含' },
                          { value: 'title_exact', label: '标题精确匹配' },
                        ]}
                      />
                    </Form.Item>
                    {(editorMode === 'create' || !editing?.builtin) && (
                      <Form.Item
                        name="promptText"
                        label="完整硬规则正文（可选）"
                        extra="若填写，将优先于上方合格/不合格标准（保存自定义规则时：有合格/不合格则仍按两段合成）"
                      >
                        <Input.TextArea
                          rows={8}
                          style={{ fontFamily: 'ui-monospace, monospace' }}
                          placeholder="一般留空，由合格/不合格标准自动生成"
                        />
                      </Form.Item>
                    )}
                    <Form.Item
                      name="jsonSchemaHint"
                      label="JSON Schema 说明（可选）"
                      extra="给模型的回传格式说明，留空则用通用简版"
                    >
                      <Input.TextArea rows={3} />
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
    </div>
  );
}
