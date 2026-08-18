import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, InputNumber, Space, Spin, Typography, message } from 'antd';
import {
  fetchAssessmentScoreRule,
  saveFinanceAssessmentScore,
} from '../../../api/finance';
import type { AssessmentScoreRuleItem, FinanceAssessment } from '../../../types/finance';

type Props = {
  open: boolean;
  month: string;
  target?: FinanceAssessment;
  onClose: () => void;
  onSaved: () => void;
};

export default function AssessmentScoreDrawer({
  open,
  month,
  target,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<AssessmentScoreRuleItem[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open || !target) return;
    setLoading(true);
    void fetchAssessmentScoreRule()
      .then((res) => {
        const enabled = (res.items || []).filter((item) => item.enabled !== false);
        setRules(enabled);
        const next: Record<string, number> = {};
        for (const item of enabled) {
          const found = target.scoreDetail?.items?.find((x) => x.ruleItemId === item.id);
          next[item.id] = found ? Number(found.score) || 0 : 0;
        }
        setScores(next);
      })
      .catch(() => {
        setRules([]);
        setScores({});
      })
      .finally(() => setLoading(false));
  }, [open, target]);

  const total = useMemo(() => {
    let base = 0;
    let bonus = 0;
    let deduct = 0;
    for (const item of rules) {
      const score = Number(scores[item.id] || 0);
      if (item.kind === 'bonus') bonus += score;
      else if (item.kind === 'deduct') deduct += score;
      else base += score;
    }
    return Math.max(0, Math.round((base + bonus - deduct) * 100) / 100);
  }, [rules, scores]);

  const grouped = useMemo(() => {
    const map = new Map<string, AssessmentScoreRuleItem[]>();
    for (const item of rules) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()];
  }, [rules]);

  const save = async () => {
    if (!target) return;
    for (const item of rules) {
      const score = Number(scores[item.id] || 0);
      if (score < 0 || score > item.maxScore) {
        message.warning(`${item.title}须在 0～${item.maxScore} 之间`);
        return;
      }
    }
    if (total > 100) {
      message.warning('总分不能超过 100');
      return;
    }
    setSaving(true);
    try {
      await saveFinanceAssessmentScore({
        month,
        userId: target.userId,
        items: rules.map((item) => ({
          ruleItemId: item.id,
          score: Number(scores[item.id] || 0),
        })),
      });
      message.success(`已保存打分，总分 ${total.toFixed(2)}`);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={target ? `打分 · ${target.realName}` : '打分'}
      width={560}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存打分
          </Button>
        </Space>
      }
    >
      <Spin spinning={loading}>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        常规项按满分填写；加分填正数累加；扣分填正数表示扣除。合计自动写入内部考核总分。
      </Typography.Paragraph>

      {grouped.map(([category, list]) => (
        <div key={category} style={{ marginBottom: 20 }}>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>
            {category}
          </Typography.Title>
          {list.map((item) => (
            <div
              key={item.id}
              style={{
                marginBottom: 12,
                padding: 12,
                background: '#f7faf8',
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {item.title}
                    <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                      满分 {item.maxScore}
                      {item.kind === 'bonus' ? ' · 加分' : item.kind === 'deduct' ? ' · 扣分' : ''}
                    </Typography.Text>
                  </div>
                  {item.description ? (
                    <div style={{ color: '#61756b', fontSize: 12, marginTop: 4 }}>
                      {item.description}
                    </div>
                  ) : null}
                </div>
                <InputNumber
                  min={0}
                  max={item.maxScore}
                  step={0.5}
                  value={scores[item.id] ?? 0}
                  onChange={(v) =>
                    setScores((prev) => ({ ...prev, [item.id]: Number(v) || 0 }))
                  }
                />
              </div>
            </div>
          ))}
        </div>
      ))}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: '12px 0',
          background: '#fff',
          borderTop: '1px solid #eef3f0',
          fontSize: 16,
          fontWeight: 650,
        }}
      >
        合计总分：{total.toFixed(2)}
      </div>
      </Spin>
    </Drawer>
  );
}
