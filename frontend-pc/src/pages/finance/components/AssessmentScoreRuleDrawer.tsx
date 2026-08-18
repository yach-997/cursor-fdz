import { useEffect, useState } from 'react';
import {
  Button,
  Drawer,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  fetchAssessmentScoreRule,
  saveAssessmentScoreRule,
} from '../../../api/finance';
import type { AssessmentScoreRuleItem } from '../../../types/finance';

type Props = {
  open: boolean;
  onClose: () => void;
};

const kindOptions = [
  { value: 'base', label: '常规项' },
  { value: 'bonus', label: '加分项' },
  { value: 'deduct', label: '扣分项' },
];

const newItem = (sort: number): AssessmentScoreRuleItem => ({
  id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  category: '未分类',
  title: '',
  maxScore: 5,
  description: '',
  sort,
  kind: 'base',
  enabled: true,
});

export default function AssessmentScoreRuleDrawer({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<AssessmentScoreRuleItem[]>([]);
  const [version, setVersion] = useState(1);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void fetchAssessmentScoreRule()
      .then((res) => {
        setItems(res.items || []);
        setVersion(res.version || 1);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const patch = (id: string, patchValue: Partial<AssessmentScoreRuleItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patchValue } : item)));
  };

  const save = async () => {
    if (!items.length) {
      message.warning('请至少保留一条规则');
      return;
    }
    if (items.some((item) => !item.title.trim())) {
      message.warning('请填写全部分项标题');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveAssessmentScoreRule(
        items.map((item, index) => ({
          ...item,
          sort: item.sort ?? (index + 1) * 10,
          description: item.description || '',
        })),
      );
      setItems(saved.items);
      setVersion(saved.version);
      message.success('打分规则已保存');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={`打分规则配置（v${version}）`}
      width={880}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存规则
          </Button>
        </Space>
      }
    >
      <p style={{ color: '#61756b', marginTop: 0 }}>
        全公司共用一套规则。默认按《月度考核打分表》预置，可改文案、满分与启用状态。扣分项填正数表示扣除。
      </p>
      <Space style={{ marginBottom: 12 }}>
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            setItems((prev) => [...prev, newItem((prev[prev.length - 1]?.sort || 0) + 10)])
          }
        >
          添加分项
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={items}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: '维度',
            width: 150,
            render: (_, row) => (
              <Input
                value={row.category}
                onChange={(e) => patch(row.id, { category: e.target.value })}
              />
            ),
          },
          {
            title: '分项',
            width: 130,
            render: (_, row) => (
              <Input value={row.title} onChange={(e) => patch(row.id, { title: e.target.value })} />
            ),
          },
          {
            title: '类型',
            width: 110,
            render: (_, row) => (
              <Select
                style={{ width: '100%' }}
                value={row.kind}
                options={kindOptions}
                onChange={(kind) => patch(row.id, { kind })}
              />
            ),
          },
          {
            title: '满分',
            width: 90,
            render: (_, row) => (
              <InputNumber
                min={0.01}
                style={{ width: '100%' }}
                value={row.maxScore}
                onChange={(v) => patch(row.id, { maxScore: Number(v) || 0 })}
              />
            ),
          },
          {
            title: '评分说明',
            render: (_, row) => (
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 3 }}
                value={row.description}
                onChange={(e) => patch(row.id, { description: e.target.value })}
              />
            ),
          },
          {
            title: '启用',
            width: 70,
            render: (_, row) => (
              <Switch
                checked={row.enabled !== false}
                onChange={(enabled) => patch(row.id, { enabled })}
              />
            ),
          },
          {
            title: '',
            width: 70,
            render: (_, row) => (
              <Button
                type="link"
                danger
                onClick={() => setItems((prev) => prev.filter((item) => item.id !== row.id))}
              >
                删除
              </Button>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
