import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal, Select, Space, Table, Tag, message } from 'antd';
import {
  fetchItemPriceMappings,
  recalculateItemPrices,
  saveItemPriceMapping,
} from '../../../api/finance';
import type { ItemPriceMappingRow } from '../../../types/finance';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export default function ItemMappingDialog({ open, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<ItemPriceMappingRow[]>([]);
  const [targetCodes, setTargetCodes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchItemPriceMappings();
      setRows(result.list);
      setTargetCodes(result.targetCodes);
      setSelected(
        Object.fromEntries(
          result.list.map((row) => [
            row.sourceItemName,
            row.targetItemCode || row.suggestedTargetCode || '',
          ]),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  const options = useMemo(
    () => targetCodes.map((code) => ({ value: code, label: code })),
    [targetCodes],
  );
  const save = async (row: ItemPriceMappingRow) => {
    const target = selected[row.sourceItemName];
    if (!target) return message.warning('请选择价格库条目编码');
    setSaving(row.sourceItemName);
    try {
      const result = await saveItemPriceMapping(row.sourceItemName, target);
      const stats = result as { pendingPrice?: number };
      message.success(`映射已保存并重算，剩余待定价 ${stats.pendingPrice ?? '-'} 条`);
      await load();
      onChanged();
    } finally {
      setSaving(undefined);
    }
  };
  const recalculate = async () => {
    setLoading(true);
    try {
      const result = await recalculateItemPrices();
      message.success(`已重算 ${result.affectedItems} 条，剩余待定价 ${result.pendingPrice} 条`);
      await load();
      onChanged();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      width={1050}
      open={open}
      title="PO 条目映射维护"
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={loading} onClick={() => void recalculate()}>
            应用内置规则并重算全部
          </Button>
        </Space>
      }
    >
      <p className="finance-tip">
        系统优先使用人工映射；未维护时按“标准化名称、型号和动作”自动匹配。只有高置信结果才会自动定价。
      </p>
      <Table
        size="small"
        rowKey="sourceItemName"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 920, y: 460 }}
        columns={[
          { title: 'PO 条目名称', dataIndex: 'sourceItemName', width: 260 },
          { title: '总条数', dataIndex: 'totalCount', width: 80 },
          {
            title: '待定价',
            dataIndex: 'pendingCount',
            width: 90,
            render: (value) => <Tag color={value ? 'warning' : 'success'}>{value}</Tag>,
          },
          {
            title: '对应价格库条目编码',
            width: 360,
            render: (_, row) => (
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                value={selected[row.sourceItemName] || undefined}
                placeholder="请选择对应编码"
                options={options}
                onChange={(value) =>
                  setSelected((current) => ({ ...current, [row.sourceItemName]: value }))
                }
              />
            ),
          },
          {
            title: '来源',
            width: 90,
            render: (_, row) =>
              row.targetItemCode ? (
                <Tag color="blue">人工</Tag>
              ) : row.suggestedTargetCode ? (
                <Tag color="cyan">系统建议</Tag>
              ) : (
                <Tag>未映射</Tag>
              ),
          },
          {
            title: '操作',
            width: 90,
            fixed: 'right' as const,
            render: (_, row) => (
              <Button
                type="link"
                loading={saving === row.sourceItemName}
                onClick={() => void save(row)}
              >
                保存并重算
              </Button>
            ),
          },
        ]}
      />
    </Modal>
  );
}
