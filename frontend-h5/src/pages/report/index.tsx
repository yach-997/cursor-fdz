import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NavBar, Cell, Empty, Tag, Image, PullRefresh, Button, Toast, Dialog } from 'react-vant';
import {
  fetchRecord,
  setRecordManualResult,
  analyzeAi,
  type RecordItem,
  type RecordEntry,
} from '../../api/record';
import { useAuthStore } from '../../stores/auth';
import { displayPhotoUrl } from '../../utils/photo-url';
import { RECORD_STATUS_LABEL, formatDateTime } from '../../utils/displayLabels';
import { resolveWorkTypeLabel } from '../../utils/workTypeLabels';
import PhotoViewerOverlay from '../../components/PhotoViewerOverlay';
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

function finalLabel(entry: RecordEntry) {
  const manual =
    entry.manualResult === 'pass' || entry.manualResult === 'fail' ? entry.manualResult : null;
  if (entry.finalResult === 'pass') {
    return {
      text: manual === 'pass' ? '合格 · 人工' : '合格',
      type: 'success' as const,
    };
  }
  if (entry.finalResult === 'fail') {
    return {
      text: manual === 'fail' ? '不合格 · 人工' : '不合格',
      type: 'danger' as const,
    };
  }
  if (entry.aiResult?.status === 'error') {
    return { text: '待判断', type: 'warning' as const };
  }
  return { text: '分析中', type: 'primary' as const };
}

/** 巡检报告：查看各条目 AI 分析结果；网格长/管理员可人工确认 */
export default function ReportPage() {
  const { recordId } = useParams();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canManualConfirm = role === 'super_admin' || role === 'site_manager';
  const [record, setRecord] = useState<RecordItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<{
    urls: string[];
    index: number;
  } | null>(null);

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
      const st =
        e.finalResult === 'pass' || e.finalResult === 'fail'
          ? e.finalResult
          : e.aiResult?.status || 'pending';
      if (st === 'pass') pass += 1;
      else if (st === 'fail') fail += 1;
      else if (st === 'error') error += 1;
      else pending += 1;
    }
    return { pass, fail, pending, error };
  }, [record]);

  const statusAllowsConfirm =
    !!record && ['submitted', 'approved', 'rejected'].includes(record.status);

  const confirmManual = async (entry: RecordEntry, result: 'pass' | 'fail') => {
    if (!record || !canManualConfirm) return;
    const label = result === 'pass' ? '合格' : '不合格';
    try {
      await Dialog.confirm({
        title: `确认设为${label}`,
        message: `将该检查项最终结论设为「${label}」？`,
      });
    } catch {
      return;
    }
    const key = `${entry.templateEntryId}:${result}`;
    setBusyKey(key);
    try {
      const fresh = await setRecordManualResult(record.id, entry.templateEntryId, result);
      setRecord(fresh);
      Toast.success(`已人工确认${label}`);
    } catch (error: any) {
      Toast.fail(error?.message || '确认失败');
    } finally {
      setBusyKey(null);
    }
  };

  const retryAnalysis = async (entry: RecordEntry) => {
    if (!record || !(entry.photos || []).length) {
      Toast.info('该检查项没有现场照片，无法重新分析');
      return;
    }
    const key = `${entry.templateEntryId}:retry`;
    setBusyKey(key);
    Toast.info('已开始重新分析');
    try {
      const tpl = snapshot.get(entry.templateEntryId);
      await analyzeAi({
        recordId: record.id,
        templateEntryId: entry.templateEntryId,
        photoUrls: entry.photos,
        samplePhotoUrls: tpl?.samplePhotos || [],
      });
      const fresh = await fetchRecord(record.id);
      setRecord(fresh);
      Toast.success('重新分析已完成');
    } catch (error: any) {
      Toast.fail(error?.message || '重新分析失败');
      try {
        const fresh = await fetchRecord(record.id);
        setRecord(fresh);
      } catch {
        // ignore
      }
    } finally {
      setBusyKey(null);
    }
  };

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
                title={
                  record.task?.taskName || `${resolveWorkTypeLabel(record.task)}报告`
                }
                label={`状态：${RECORD_STATUS_LABEL[record.status] || '未知状态'}${
                  record.submittedAt
                    ? ` · 提交 ${formatDateTime(record.submittedAt)}`
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

            {record.location ? (
              <Cell.Group inset title="现场定位" style={{ marginTop: 12 }}>
                <Cell
                  title="状态"
                  value={
                    record.location.status === 'failed' ||
                    record.location.status === 'skipped'
                      ? '位置异常'
                      : record.location.status === 'weak'
                        ? '弱定位'
                        : record.location.latitude != null
                          ? '正常'
                          : '未知'
                  }
                />
                {record.location.latitude != null && record.location.longitude != null ? (
                  <Cell
                    title="经纬度"
                    value={`${Number(record.location.latitude).toFixed(6)}, ${Number(
                      record.location.longitude,
                    ).toFixed(6)}`}
                  />
                ) : (
                  <Cell
                    title="说明"
                    value={
                      record.location.reason ||
                      (record.location.status === 'skipped'
                        ? '工程师确认无法定位后继续作业'
                        : '未能获取现场定位')
                    }
                  />
                )}
                {record.location.address ? (
                  <Cell title="地址" value={record.location.address} />
                ) : null}
                {(record.location.accuracyMeters != null &&
                  record.location.accuracyMeters > 0) ||
                record.location.distanceToSiteMeters != null ? (
                  <Cell
                    title="精度/距离"
                    value={`${
                      record.location.accuracyMeters != null &&
                      record.location.accuracyMeters > 0
                        ? `约 ${record.location.accuracyMeters} 米`
                        : '-'
                    }${
                      record.location.distanceToSiteMeters != null
                        ? ` · 距归属网格约 ${record.location.distanceToSiteMeters} 米`
                        : ''
                    }`}
                  />
                ) : null}
              </Cell.Group>
            ) : null}

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
              const final = finalLabel(entry);
              const needRedo = record.rejectReason?.entryIds?.includes(entry.templateEntryId);
              const selected =
                entry.manualResult === 'pass' || entry.manualResult === 'fail'
                  ? entry.manualResult
                  : entry.finalResult === 'pass' || entry.finalResult === 'fail'
                    ? entry.finalResult
                    : null;
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
                      title="结论"
                      value={<Tag type={final.type}>{final.text}</Tag>}
                      label={
                        entry.aiResult
                          ? `AI ${AI_LABEL[st] || '待判断'}${
                              ['pass', 'fail'].includes(st)
                                ? ` ${Math.round((entry.aiResult.confidence || 0) * 100)}%`
                                : ''
                            }${entry.aiResult.reason ? ` · ${entry.aiResult.reason}` : ''}`
                          : '等待 AI 分析'
                      }
                    />
                    {(entry.photos || []).length > 0 && (
                      <Cell title="现场照片">
                        <div className="report-photos">
                          {entry.photos.map((url, photoIdx) => (
                            <button
                              key={url}
                              type="button"
                              className="report-photo-btn"
                              onClick={() =>
                                setPhotoPreview({ urls: entry.photos, index: photoIdx })
                              }
                            >
                              <Image
                                src={displayPhotoUrl(url)}
                                width={72}
                                height={72}
                                fit="cover"
                                radius={10}
                              />
                            </button>
                          ))}
                        </div>
                      </Cell>
                    )}
                    {entry.remark ? <Cell title="备注" label={entry.remark} /> : null}
                    {canManualConfirm && statusAllowsConfirm ? (
                      <Cell>
                        <div className="report-entry-actions">
                          <div className="report-entry-toggle">
                            <Button
                              size="small"
                              round
                              type={selected === 'pass' ? 'primary' : 'default'}
                              loading={busyKey === `${entry.templateEntryId}:pass`}
                              onClick={() => void confirmManual(entry, 'pass')}
                            >
                              合格
                            </Button>
                            <Button
                              size="small"
                              round
                              type={selected === 'fail' ? 'danger' : 'default'}
                              loading={busyKey === `${entry.templateEntryId}:fail`}
                              onClick={() => void confirmManual(entry, 'fail')}
                            >
                              不合格
                            </Button>
                          </div>
                          {(entry.photos || []).length > 0 ? (
                            <Button
                              size="small"
                              round
                              plain
                              hairline
                              loading={busyKey === `${entry.templateEntryId}:retry`}
                              onClick={() => void retryAnalysis(entry)}
                            >
                              重新分析
                            </Button>
                          ) : null}
                        </div>
                      </Cell>
                    ) : null}
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
      {photoPreview && (
        <PhotoViewerOverlay
          urls={photoPreview.urls}
          initialIndex={photoPreview.index}
          onClose={() => setPhotoPreview(null)}
        />
      )}
    </div>
  );
}
