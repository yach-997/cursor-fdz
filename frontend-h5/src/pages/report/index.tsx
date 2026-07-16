import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NavBar, Cell, Empty, Tag, Image, PullRefresh, Button } from 'react-vant';
import { fetchRecord, type RecordItem } from '../../api/record';
import { displayPhotoUrl } from '../../utils/photo-url';
import { RECORD_STATUS_LABEL } from '../../utils/displayLabels';
import './report.css';

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
    <div className="report-page">
      <NavBar title="智能分析报告" leftText="返回" onClickLeft={() => navigate(-1)} />

      {loading && !record ? (
        <Empty description="加载中..." />
      ) : !record ? (
        <Empty description="报告不存在" />
      ) : (
        <PullRefresh onRefresh={load}>
          <div className="report-body">
            <Cell.Group inset>
              <Cell
                title={record.task?.taskName || '巡检报告'}
                label={`状态：${RECORD_STATUS_LABEL[record.status] || '未知状态'}${
                  record.submittedAt
                    ? ` · 提交 ${String(record.submittedAt).slice(0, 16)}`
                    : ''
                }`}
              />
            </Cell.Group>

            <div className="report-summary">
              <div className="is-pass">
                <b>{summary.pass}</b>
                <span>合格</span>
              </div>
              <div className="is-fail">
                <b>{summary.fail}</b>
                <span>不合格</span>
              </div>
              <div className="is-pending">
                <b>{summary.pending}</b>
                <span>分析中</span>
              </div>
              <div className="is-error">
                <b>{summary.error}</b>
                <span>失败</span>
              </div>
            </div>

            {record.rejectReason?.reason && (
              <div className="report-alert report-alert--reject">
                <div className="report-alert__title">管理员驳回</div>
                <div>原因：{record.rejectReason.reason}</div>
                {record.rejectReason.entryIds?.length ? (
                  <div className="report-alert__tags">
                    需返工：
                    {record.rejectReason.entryIds.map((eid) => (
                      <Tag key={eid} type="danger">
                        {snapshot.get(eid)?.name || eid.slice(0, 8)}
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {summary.pending > 0 && (
              <div className="report-alert report-alert--pending">
                仍有 {summary.pending} 项正在分析，页面会自动刷新；超过 3
                分钟将自动转人工审核。
              </div>
            )}

            {record.entries.map((entry, idx) => {
              const tpl = snapshot.get(entry.templateEntryId);
              const st = entry.aiResult?.status || 'pending';
              const needRedo = record.rejectReason?.entryIds?.includes(entry.templateEntryId);
              return (
                <div
                  key={entry.templateEntryId}
                  className={`report-entry${needRedo ? ' is-redo' : ''}`}
                >
                  <Cell.Group
                    inset
                    title={`${idx + 1}. ${tpl?.name || '检查项'}${needRedo ? ' · 需返工' : ''}`}
                  >
                    <Cell
                      title="智能分析结论"
                      value={
                        <Tag type={AI_TAG[st] || 'primary'}>{AI_LABEL[st] || '待人工判断'}</Tag>
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
                        <div className="report-photos">
                          {entry.photos.map((url) => (
                            <Image
                              key={url}
                              src={displayPhotoUrl(url)}
                              width={72}
                              height={72}
                              fit="cover"
                              radius={10}
                            />
                          ))}
                        </div>
                      </Cell>
                    )}
                    {entry.remark ? <Cell title="备注" label={entry.remark} /> : null}
                  </Cell.Group>
                </div>
              );
            })}

            <div className="report-actions">
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
