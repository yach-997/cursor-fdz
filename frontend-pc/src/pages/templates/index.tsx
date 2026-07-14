import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, CopyOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  cloneTemplate,
  type TemplateItem,
  type TemplateEntry,
} from '../../api/template';
import { fetchSites } from '../../api/site';
import { useAuthStore } from '../../stores/auth';
import type { DeviceType, SiteItem } from '../../types';
import { DEVICE_TYPE_LABEL } from '../../types';
import { uploadImage } from '../../api/upload';
import { displayPhotoUrl } from '../../utils/photo-url';

const DEVICE_TABS: DeviceType[] = [
  'string_inverter',
  'central_inverter',
  'energy_storage',
];

/** 模板配置：按设备类型 Tab，条目编辑排序，克隆到站点 */
export default function TemplatesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'super_admin';

  const [deviceType, setDeviceType] = useState<DeviceType>('string_inverter');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<TemplateItem[]>([]);
  const [sites, setSites] = useState<SiteItem[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [form] = Form.useForm();
  const [entries, setEntries] = useState<TemplateEntry[]>([]);

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneTpl, setCloneTpl] = useState<TemplateItem | null>(null);
  const [cloneSiteId, setCloneSiteId] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTemplates({ deviceType });
      setList(data);
    } finally {
      setLoading(false);
    }
  }, [deviceType]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchSites({ limit: 100, status: 'active' }).then((res) => setSites(res.list));
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      name: `${DEVICE_TYPE_LABEL[deviceType]}巡检模板`,
      isGlobal: isAdmin,
      deviceType,
    });
    setEntries([
      {
        id: `tmp-${Date.now()}`,
        name: '检查项1',
        description: '',
        isRequired: true,
        order: 0,
        samplePhotos: [],
        checkType: 'photo',
      },
    ]);
    setModalOpen(true);
  };

  const openEdit = (record: TemplateItem) => {
    setEditing(record);
    form.setFieldsValue(record);
    setEntries([...(record.entries || [])].sort((a, b) => a.order - b.order));
    setModalOpen(true);
  };

  const moveEntry = (index: number, dir: -1 | 1) => {
    const next = [...entries];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setEntries(next.map((e, i) => ({ ...e, order: i })));
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (!entries.length) {
      message.warning('至少添加一个检查条目');
      return;
    }
    const payload = {
      ...values,
      deviceType: values.deviceType || deviceType,
      entries: entries.map((e, i) => ({ ...e, order: i })),
      siteId: values.isGlobal ? null : values.siteId,
    };
    if (editing) {
      await updateTemplate(editing.id, payload);
      message.success(`模板已更新（版本将 +1）`);
    } else {
      await createTemplate(payload);
      message.success('模板已创建');
    }
    setModalOpen(false);
    load();
  };

  const columns: ColumnsType<TemplateItem> = [
    { title: '模板名称', dataIndex: 'name' },
    {
      title: '范围',
      width: 100,
      render: (_, r) =>
        r.isGlobal ? <Tag color="blue">全局</Tag> : <Tag color="green">站点</Tag>,
    },
    {
      title: '条目数',
      width: 80,
      render: (_, r) => r.entries?.length || 0,
    },
    { title: '版本', dataIndex: 'version', width: 70 },
    {
      title: '操作',
      width: 260,
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button
            type="link"
            icon={<CopyOutlined />}
            onClick={() => {
              setCloneTpl(record);
              setCloneSiteId(sites[0]?.id);
              setCloneOpen(true);
            }}
          >
            克隆到站点
          </Button>
          <Popconfirm title="确认删除模板？" onConfirm={() => deleteTemplate(record.id).then(load)}>
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const entryEditor = useMemo(
    () => (
      <div>
        {entries.map((entry, index) => (
          <Card
            key={entry.id}
            size="small"
            style={{ marginBottom: 8 }}
            title={`条目 ${index + 1}`}
            extra={
              <Space>
                <Button size="small" disabled={index === 0} onClick={() => moveEntry(index, -1)}>
                  上移
                </Button>
                <Button
                  size="small"
                  disabled={index === entries.length - 1}
                  onClick={() => moveEntry(index, 1)}
                >
                  下移
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() => setEntries(entries.filter((_, i) => i !== index))}
                >
                  删除
                </Button>
              </Space>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder="条目名称"
                value={entry.name}
                onChange={(e) => {
                  const next = [...entries];
                  next[index] = { ...entry, name: e.target.value };
                  setEntries(next);
                }}
              />
              <Input.TextArea
                placeholder="检查要求说明"
                rows={2}
                value={entry.description}
                onChange={(e) => {
                  const next = [...entries];
                  next[index] = { ...entry, description: e.target.value };
                  setEntries(next);
                }}
              />
              <Space wrap>
                <Checkbox
                  checked={entry.isRequired && !entry.isOptionalModule}
                  disabled={!!entry.isOptionalModule}
                  onChange={(e) => {
                    const next = [...entries];
                    next[index] = { ...entry, isRequired: e.target.checked };
                    setEntries(next);
                  }}
                >
                  必填
                </Checkbox>
                <Checkbox
                  checked={!!entry.isOptionalModule}
                  onChange={(e) => {
                    const next = [...entries];
                    next[index] = {
                      ...entry,
                      isOptionalModule: e.target.checked,
                      // 可选分项默认非必填，由巡检员现场开启后再检
                      isRequired: e.target.checked ? false : entry.isRequired,
                    };
                    setEntries(next);
                  }}
                >
                  可选分项（如中压变压器）
                </Checkbox>
                <Select
                  style={{ width: 120 }}
                  value={entry.checkType}
                  onChange={(v) => {
                    const next = [...entries];
                    next[index] = { ...entry, checkType: v };
                    setEntries(next);
                  }}
                  options={[
                    { value: 'photo', label: '拍照' },
                    { value: 'text', label: '文本' },
                  ]}
                />
              </Space>
              {(entry.samplePhotos || []).length > 0 && (
                <Space wrap>
                  {entry.samplePhotos!.map((url) => (
                    <div key={url} style={{ position: 'relative' }}>
                      <img src={displayPhotoUrl(url)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }} />
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          const next = [...entries];
                          next[index] = {
                            ...entry,
                            samplePhotos: entry.samplePhotos!.filter((u) => u !== url),
                          };
                          setEntries(next);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                </Space>
              )}
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={(file) => {
                  const siteName = form.getFieldValue('siteId')
                    ? sites.find((s) => s.id === form.getFieldValue('siteId'))?.name
                    : '全局模板';
                  uploadImage(file as File, { siteName, serialNumber: '样本图' })
                    .then((res) => {
                      const next = [...entries];
                      next[index] = {
                        ...entry,
                        samplePhotos: [...(entry.samplePhotos || []), res.url],
                      };
                      setEntries(next);
                      message.success('样本图已上传');
                    })
                    .catch(() => undefined);
                  return false;
                }}
              >
                <Button size="small" icon={<UploadOutlined />}>
                  上传样本图
                </Button>
              </Upload>
            </Space>
          </Card>
        ))}
        <Button
          block
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() =>
            setEntries([
              ...entries,
              {
                id: `tmp-${Date.now()}`,
                name: `检查项${entries.length + 1}`,
                description: '',
                isRequired: true,
                order: entries.length,
                samplePhotos: [],
                checkType: 'photo',
              },
            ])
          }
        >
          添加条目
        </Button>
      </div>
    ),
    [entries],
  );

  return (
    <div>
      <Tabs
        activeKey={deviceType}
        onChange={(k) => setDeviceType(k as DeviceType)}
        items={DEVICE_TABS.map((t) => ({ key: t, label: DEVICE_TYPE_LABEL[t] }))}
      />
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建模板
        </Button>
      </Space>
      <Table rowKey="id" loading={loading} columns={columns} dataSource={list} pagination={false} />

      <Modal
        title={editing ? `编辑模板（当前 v${editing.version}）` : '新建模板'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="deviceType" label="设备类型" initialValue={deviceType} hidden>
            <Input />
          </Form.Item>
          {isAdmin && (
            <Form.Item name="isGlobal" label="全局模板" valuePropName="checked">
              <Checkbox>作为全局模板（所有站点可用）</Checkbox>
            </Form.Item>
          )}
          <Form.Item noStyle shouldUpdate={(p, c) => p.isGlobal !== c.isGlobal}>
            {() =>
              !form.getFieldValue('isGlobal') ? (
                <Form.Item name="siteId" label="所属站点" rules={[{ required: true }]}>
                  <Select
                    options={sites.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item label="检查条目（可上下移动排序）" required>
            {entryEditor}
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`克隆到站点 - ${cloneTpl?.name || ''}`}
        open={cloneOpen}
        onCancel={() => setCloneOpen(false)}
        onOk={async () => {
          if (!cloneTpl || !cloneSiteId) return;
          await cloneTemplate(cloneTpl.id, cloneSiteId);
          message.success('已克隆到站点');
          setCloneOpen(false);
          load();
        }}
      >
        <Select
          style={{ width: '100%' }}
          value={cloneSiteId}
          onChange={setCloneSiteId}
          options={sites.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` }))}
        />
      </Modal>
    </div>
  );
}
