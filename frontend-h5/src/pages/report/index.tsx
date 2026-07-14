import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NavBar, Cell, Empty, Tag, Image, PullRefresh, Button } from 'react-vant';
import { fetchRecord, type RecordItem } from '../../api/record';

const AI_LABEL: Record<string, string> = {
  pass: '合格',
  fail: '不合格',
  pending: '分析中',
  error: '分析失败',
};

const AI_TAG: Record<string, 'success' | 'danger' | 'primary' | 'warning'> = {
  pass: 'success',
  fail: 'danger',
  pending: 'primary',
  error: 'warning',
};

/** 巡检报告：查看各条目 AI 分析结果（可稍后回来刷新） */
export default function ReportPage() {
  const { recordId } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<RecordItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    try {
      const r = await fetchRecord(recordId);
      setRecord(r);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // 若仍有分析中，定时刷新
  useEffect(() => {
    if (!record) return;
    const pending = record.entries.some(
      (e) => !e.aiResult || e.aiResult.status === 'pending',
    );
    if (!pending) return;
    const t = window.setInterval(() => {
      void load();
    }, 3000);
    return () => window.clearInterval(t);
  }, [record, load]);

  const snapshot = useMemo(() => {
    const map = new Map(
      (record?.task?.templateSnapshot || []).map((e) => [e.id, e]),
    );
    return map;
  }, [record]);

  const summary = useMemo(() => {
    if (!record) return { pass: 0, fail: 0, pending: 0, error: 0 };
    let pass = 0;
    let fail = 0;
    let pending = 0;
    let error = 0;
    for (const e of record.entries) {
      const st = e.aiResult?.status || 'pending';
      if (st === 'pass') pass += 1;
      else if (st === 'fail') fail += 1;
      else if (st === 'error') error += 1;
      else pending += 1;
    }
    return { pass, fail, pending, error };
  }, [record]);

  return (
    <div style={{ minHeight: '100vh', background: '#f2f5f3', paddingBottom: 24 }}>
      <NavBar title="AI 分析报告" leftText="返回" onClickLeft={() => navigate(-1)} />

      {loading && !record ? (
        <Empty description="加载中..." />
      ) : !record ? (
        <Empty description="报告不存在" />
      ) : (
        <PullRefresh onRefresh={load}>
          <div style={{ padding: 12 }}>
            <Cell.Group inset>
              <Cell
                title={record.task?.taskName || '巡检报告'}
                label={`状态：${
                  record.status === 'rejected'
                    ? '已驳回'
                    : record.status === 'draft'
                      ? '进行中'
                      : record.status
                }${
                  record.submittedAt
                    ? ` · 提交 ${String(record.submittedAt).slice(0, 16)}`
                    : ''
                }`}
              />
              <Cell
                title="AI 汇总"
                label={`合格 ${summary.pass} · 不合格 ${summary.fail} · 分析中 ${summary.pending} · 失败 ${summary.error}`}
              />
            </Cell.Group>

            {record.rejectReason?.reason && (
              <div
                style={{
                  margin: '12px 4px',
                  padding: 12,
                  background: '#fff1f0',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#a8071a',
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600 }}>管理员驳回</div>
                <div style={{ marginTop: 4 }}>原因：{record.rejectReason.reason}</div>
                {record.rejectReason.entryIds?.length ? (
                  <div style={{ marginTop: 8 }}>
                    需返工：
                    {record.rejectReason.entryIds.map((eid) => (
                      <Tag key={eid} type="danger" style={{ marginLeft: 6, marginTop: 4 }}>
                        {snapshot.get(eid)?.name || eid.slice(0, 8)}
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {summary.pending > 0 && (
              <div
                style={{
                  margin: '12px 4px',
                  padding: 10,
                  background: '#fff7e6',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#ad6800',
                }}
              >
                仍有 {summary.pending} 项在后台分析，下拉刷新或稍后再看。
              </div>
            )}

            {record.entries.map((entry, idx) => {
              const tpl = snapshot.get(entry.templateEntryId);
              const st = entry.aiResult?.status || 'pending';
              const needRedo = record.rejectReason?.entryIds?.includes(entry.templateEntryId);
              return (
                <Cell.Group
                  key={entry.templateEntryId}
                  inset
                  style={{
                    marginTop: 12,
                    border: needRedo ? '1px solid #ffa39e' : undefined,
                  }}
                  title={`${idx + 1}. ${tpl?.name || '检查项'}${needRedo ? ' · 需返工' : ''}`}
                >
                  <Cell
                    title="AI 结论"
                    value={
                      <Tag type={AI_TAG[st] || 'primary'}>{AI_LABEL[st] || st}</Tag>
                    }
                    label={
                      entry.aiResult
                        ? `置信度 ${Math.round((entry.aiResult.confidence || 0) * 100)}% · ${
                            entry.aiResult.reason || ''
                          }`
                        : '等待分析'
                    }
                  />
                  {(entry.photos || []).length > 0 && (
                    <Cell title="现场照片">
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {entry.photos.map((url) => (
                          <Image
                            key={url}
                            src={url}
                            width={72}
                            height={72}
                            fit="cover"
                            radius={6}
                          />
                        ))}
                      </div>
                    </Cell>
                  )}
                  {entry.remark ? <Cell title="备注" label={entry.remark} /> : null}
                </Cell.Group>
              );
            })}

            <div style={{ padding: '16px 4px' }}>
              <Button block round onClick={() => navigate('/m/tasks')}>
                返回任务列表
              </Button>
            </div>
          </div>
        </PullRefresh>
      )}
    </div>
  );
}
