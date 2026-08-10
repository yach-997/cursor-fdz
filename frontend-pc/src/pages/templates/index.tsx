import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type TemplateItem,
  type TemplateEntry,
  type TemplateProductLine,
} from '../../api/template';
import { useAuthStore } from '../../stores/auth';
import { uploadImage } from '../../api/upload';
import { displayPhotoUrl } from '../../utils/photo-url';

function emptyEntry(order = 0): TemplateEntry {
  return {
    id: `tmp-${Date.now()}-${order}`,
    name: `检查项${order + 1}`,
    description: '',
    isRequired: true,
    order,
    samplePhotos: [],
    checkType: 'photo',
  };
}

/** 服务类型（对齐 GSP / PO）：全司统一配置检查条目与产品线 */
export default function TemplatesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const canManage =
    currentUser?.role === 'super_admin' || currentUser?.role === 'site_manager';
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);

  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<TemplateItem[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [form] = Form.useForm();
  const [productLines, setProductLines] = useState<TemplateProductLine[]>([]);
  /** 当前编辑的产品线 id */
  const [activeLineId, setActiveLineId] = useState<string>('');
  const [entries, setEntries] = useState<TemplateEntry[]>([]);
  const [uploadingEntry, setUploadingEntry] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTemplates({
        keyword: searchKeyword || undefined,
      });
      setList(data.filter((t) => t.isGlobal));
    } finally {
      setLoading(false);
    }
  }, [searchKeyword]);

  useEffect(() => {
    load();
  }, [load]);

  const persistActiveEntries = useCallback(
    (nextEntries: TemplateEntry[], lineId = activeLineId) => {
      if (!lineId) return;
      setProductLines((prev) =>
        prev.map((p) => (p.id === lineId ? { ...p, entries: nextEntries } : p)),
      );
    },
    [activeLineId],
  );

  const switchLine = (lineId: string) => {
    if (!lineId || lineId === activeLineId) return;
    persistActiveEntries(entries);
    setActiveLineId(lineId);
    const line = productLines.find((p) => p.id === lineId);
    setEntries([...(line?.entries || [])]);
  };

  const openCreate = (presetName = '', presetLine = '') => {
    if (!canManage) {
      message.warning('无权新建服务类型');
      return;
    }
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      name: presetName || '',
    });
    const lineId = `pl-${Date.now()}`;
    const line: TemplateProductLine = {
      id: lineId,
      name: String(presetLine || '').trim(),
      entries: [emptyEntry(0)],
    };
    setProductLines([line]);
    setActiveLineId(lineId);
    setEntries(line.entries);
    setModalOpen(true);
    if (presetLine) {
      message.info(`请完善产品线「${presetLine}」的检查条目后保存`);
    }
  };

  const openEdit = (record: TemplateItem, suggestedLine = '') => {
    setEditing(record);
    form.setFieldsValue(record);
    const defs = [...(record.entries || [])].sort((a, b) => a.order - b.order);
    let lines = [...(record.productLines || [])].map((p) => ({
      ...p,
      entries: [...(p.entries || [])].sort((a, b) => a.order - b.order),
    }));
    // 旧数据仅有通用条目：迁入一条产品线，预填名称避免空白无法保存
    if (!lines.length && defs.length) {
      const id = `pl-${Date.now()}`;
      lines = [{ id, name: record.name?.trim() || '默认', entries: defs }];
    }
    const want = String(suggestedLine || '').trim();
    if (want && !lines.some((p) => String(p.name || '').trim() === want)) {
      const id = `pl-${Date.now()}-suggest`;
      const newLine: TemplateProductLine = {
        id,
        name: want,
        entries: [emptyEntry(0)],
      };
      lines = [...lines, newLine];
      setProductLines(lines);
      setActiveLineId(id);
      setEntries([...(newLine.entries || [])]);
      setModalOpen(true);
      message.info(`已预填产品线「${want}」，请配置检查条目后保存`);
      return;
    }
    setProductLines(lines);
    if (want) {
      const hit = lines.find((p) => String(p.name || '').trim() === want);
      if (hit) {
        setActiveLineId(hit.id);
        setEntries([...(hit.entries || [])]);
        setModalOpen(true);
        message.info(`产品线「${want}」已存在，请确认检查条目后保存`);
        return;
      }
    }
    if (lines.length) {
      setActiveLineId(lines[0].id);
      setEntries([...(lines[0].entries || [])]);
    } else {
      setActiveLineId('');
      setEntries([]);
    }
    setModalOpen(true);
  };

  // 从案例列表「待补产品线 / 待补类型」跳转：自动打开对应服务类型并预填产品线
  useEffect(() => {
    if (deepLinkHandled.current || loading) return;
    const templateId = searchParams.get('templateId');
    const createName = String(searchParams.get('createName') || '').trim();
    const addLine = String(searchParams.get('addLine') || '').trim();
    if (!templateId && !createName) return;
    // list 尚空时等下一轮；有 createName 也可在空列表时新建
    if (!list.length && templateId && !createName) return;
    deepLinkHandled.current = true;
    if (templateId) {
      const tpl = list.find((t) => t.id === templateId);
      if (tpl) openEdit(tpl, addLine);
      else if (createName) openCreate(createName, addLine);
      else message.warning('未找到对应服务类型');
    } else if (createName) {
      const exist = list.find((t) => t.name === createName);
      if (exist) openEdit(exist, addLine);
      else openCreate(createName, addLine);
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅处理一次深链入参
  }, [list, loading, searchParams, setSearchParams]);

  const moveEntry = useCallback((index: number, dir: -1 | 1) => {
    setEntries((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((e, i) => ({ ...e, order: i }));
    });
  }, []);

  const submit = async () => {
    if (!canManage) {
      setModalOpen(false);
      return;
    }
    const values = await form.validateFields();
    const lines = productLines.map((p) =>
      p.id === activeLineId ? { ...p, entries } : p,
    );
    if (!lines.length) {
      message.warning('请至少添加一条产品线');
      return;
    }
    for (const line of lines) {
      if (!String(line.name || '').trim()) {
        message.warning('产品线名称不能为空');
        return;
      }
      if (!line.entries?.length) {
        message.warning(`产品线「${line.name}」至少需要一个检查条目`);
        return;
      }
    }
    const payload = {
      ...values,
      isGlobal: true,
      siteId: null,
      unitLabel: '台',
      assignMode: 'single',
      expenseEnabledDefault: false,
      entries: [],
      productLines: lines.map((p) => ({
        ...p,
        name: String(p.name || '').trim(),
        entries: (p.entries || []).map((e, i) => ({ ...e, order: i })),
      })),
    };
    delete (payload as { deviceType?: unknown }).deviceType;
    if (editing) {
      const nextName = String(values.name || '').trim();
      const prevName = String(editing.name || '').trim();
      if (nextName && prevName && nextName !== prevName) {
        const ok = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '确认修改服务类型名称？',
            content: (
              <div>
                <p>
                  将「{prevName}」改为「{nextName}」。
                </p>
                <p style={{ color: '#8c8c8c', marginBottom: 0 }}>
                  已绑定到本类型的案例会同步改名为「{nextName}」；之后导入也请使用新名称才能自动匹配。
                </p>
              </div>
            ),
            okText: '确认改名',
            cancelText: '取消',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!ok) return;
      }
      const prevVersion = editing.version;
      const saved = await updateTemplate(editing.id, payload);
      const syncTip =
        saved.syncedCases && saved.syncedCases > 0
          ? `，已同步改名 ${saved.syncedCases} 个案例`
          : '';
      const rematchTip =
        saved.rematchedCases && saved.rematchedCases > 0
          ? `，另匹配 ${saved.rematchedCases} 个案例`
          : '';
      if (saved.versionChanged || saved.version !== prevVersion) {
        message.success(`已更新，检查项变更 → v${saved.version}${syncTip}${rematchTip}`);
      } else {
        message.success(`已更新${syncTip}${rematchTip}`);
      }
    } else {
      const saved = await createTemplate(payload);
      const rematchTip =
        saved.rematchedCases && saved.rematchedCases > 0
          ? `，已自动匹配 ${saved.rematchedCases} 个案例`
          : '';
      message.success(`服务类型已创建${rematchTip}`);
    }
    setModalOpen(false);
    load();
  };

  const columns: ColumnsType<TemplateItem> = [
    { title: '服务类型名称', dataIndex: 'name' },
    {
      title: '产品线',
      width: 280,
      render: (_, r) => {
        const lines = r.productLines || [];
        if (!lines.length) return <span style={{ color: '#bfbfbf' }}>未配置</span>;
        return (
          <Space size={[4, 4]} wrap>
            {lines.slice(0, 4).map((p) => (
              <Tag key={p.id} color="cyan">
                {p.name}
                {p.entries?.length ? ` · ${p.entries.length}项` : ''}
              </Tag>
            ))}
            {lines.length > 4 ? <Tag>+{lines.length - 4}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: (
        <span>
          版本{' '}
          <Tooltip title="仅检查项/产品线变更时递增；进行中任务仍用创建时快照">
            <QuestionCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'version',
      width: 80,
    },
    {
      title: '操作',
      width: canManage ? 160 : 80,
      render: (_, record) =>
        canManage ? (
          <Space>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除该服务类型？"
              description="已被案例引用时无法删除"
              onConfirm={async () => {
                try {
                  await deleteTemplate(record.id);
                  message.success('已删除');
                  await load();
                } catch {
                  /* interceptor 已提示 */
                }
              }}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Button type="link" onClick={() => openEdit(record)}>
            查看
          </Button>
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
                      // 可选分项默认非必填，由工程师现场开启后再检
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
                <Image.PreviewGroup>
                  <Space wrap>
                    {entry.samplePhotos!.map((url) => (
                      <div key={url} style={{ position: 'relative' }}>
                        <Image
                          src={displayPhotoUrl(url)}
                          width={72}
                          height={72}
                          style={{ objectFit: 'cover', borderRadius: 6, cursor: 'pointer' }}
                        />
                        <Button
                          size="small"
                          type="link"
                          danger
                          onClick={(e) => {
                            e.stopPropagation();
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
                </Image.PreviewGroup>
              )}
              <Upload
                accept="image/*"
                multiple
                showUploadList={false}
                disabled={uploadingEntry === index}
                beforeUpload={(file, fileList) => {
                  // multiple 时每个文件都会触发一次；只在最后一份时统一批量上传
                  if (file !== fileList[fileList.length - 1]) return false;

                  const siteName = '服务类型';
                  const files = fileList.filter((f) => f.type?.startsWith('image/') || !f.type);
                  if (!files.length) {
                    message.warning('请选择图片文件');
                    return false;
                  }

                  setUploadingEntry(index);
                  const hide = message.loading(
                    files.length > 1
                      ? `正在压缩并上传 ${files.length} 张样本图…`
                      : '正在压缩并上传样本图…',
                    0,
                  );

                  void (async () => {
                    let ok = 0;
                    let fail = 0;
                    const urls: string[] = [];
                    // 限流并发，避免一次打满直传
                    const concurrency = 3;
                    let cursor = 0;
                    const workers = Array.from(
                      { length: Math.min(concurrency, files.length) },
                      async () => {
                        while (cursor < files.length) {
                          const current = files[cursor++];
                          try {
                            const res = await uploadImage(current as File, {
                              siteName,
                              serialNumber: '样本图',
                            });
                            urls.push(res.url);
                            ok += 1;
                          } catch {
                            fail += 1;
                          }
                        }
                      },
                    );
                    await Promise.all(workers);

                    if (urls.length) {
                      setEntries((prev) => {
                        const next = [...prev];
                        const cur = next[index];
                        if (!cur) return prev;
                        next[index] = {
                          ...cur,
                          samplePhotos: [...(cur.samplePhotos || []), ...urls],
                        };
                        return next;
                      });
                    }

                    if (fail === 0) {
                      message.success(
                        files.length > 1 ? `已上传 ${ok} 张样本图` : '样本图已上传',
                      );
                    } else if (ok > 0) {
                      message.warning(`成功 ${ok} 张，失败 ${fail} 张`);
                    } else {
                      message.error('样本图上传失败，请重试');
                    }
                  })()
                    .catch(() => undefined)
                    .finally(() => {
                      hide();
                      setUploadingEntry(null);
                    });

                  return false;
                }}
              >
                <Button
                  size="small"
                  icon={<UploadOutlined />}
                  loading={uploadingEntry === index}
                >
                  上传样本图（可多选）
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
    [entries, form, moveEntry, uploadingEntry],
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="搜索服务类型名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={(v) => setSearchKeyword(v.trim())}
          style={{ width: 260 }}
        />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
            新建服务类型
          </Button>
        )}
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={
          editing
            ? canManage
              ? `编辑服务类型（当前 v${editing.version}）`
              : `查看服务类型（v${editing.version}）`
            : '新建服务类型'
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submit()}
        okButtonProps={{ style: canManage ? undefined : { display: 'none' } }}
        cancelText={canManage ? '取消' : '关闭'}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item
            name="name"
            label="服务类型名称"
            rules={[{ required: true }]}
            extra="与 GSP「服务类型」、PO「需求类型」精确同名才会自动匹配。改名后，已绑定案例会同步改名；之后导入请用新名称。"
          >
            <Input placeholder="例如：巡检、故障恢复、整改、维护、交付" />
          </Form.Item>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>产品线</div>
            <p style={{ color: '#666', marginBottom: 8, fontSize: 12 }}>
              产品线对应 PO「产品线」；改检查项只影响之后新建的任务。
            </p>
            <Space wrap style={{ marginBottom: 8 }}>
              {productLines.map((line) => (
                <Button
                  key={line.id}
                  type={activeLineId === line.id ? 'primary' : 'default'}
                  size="small"
                  onClick={() => switchLine(line.id)}
                >
                  {line.name?.trim() || '未命名'}
                </Button>
              ))}
              {canManage ? (
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    if (activeLineId) persistActiveEntries(entries);
                    const id = `pl-${Date.now()}`;
                    const line: TemplateProductLine = {
                      id,
                      name: '',
                      entries: [emptyEntry(0)],
                    };
                    setProductLines((prev) => [...prev, line]);
                    setActiveLineId(id);
                    setEntries(line.entries);
                  }}
                >
                  添加产品线
                </Button>
              ) : null}
            </Space>
            {activeLineId ? (
              <Space style={{ marginBottom: 12, width: '100%' }} align="start">
                <Input
                  style={{ flex: 1, minWidth: 200 }}
                  disabled={!canManage}
                  value={productLines.find((p) => p.id === activeLineId)?.name || ''}
                  placeholder="填写产品线名称，如：地面-组串式"
                  onChange={(e) => {
                    const name = e.target.value;
                    setProductLines((prev) =>
                      prev.map((p) => (p.id === activeLineId ? { ...p, name } : p)),
                    );
                  }}
                />
                {canManage ? (
                  <Button
                    danger
                    onClick={() => {
                      const rest = productLines.filter((p) => p.id !== activeLineId);
                      setProductLines(rest);
                      if (rest.length) {
                        setActiveLineId(rest[0].id);
                        setEntries([...(rest[0].entries || [])]);
                      } else {
                        setActiveLineId('');
                        setEntries([]);
                      }
                    }}
                  >
                    删除该产品线
                  </Button>
                ) : null}
              </Space>
            ) : null}
          </div>
          {activeLineId ? (
            <Form.Item label="当前产品线检查条目" required>
              {entryEditor}
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
