import { useEffect, useState } from 'react';
import { Drawer, Modal, Tag, Timeline, message } from 'antd';
import {
  analyzeAi,
  fetchRecord,
  resolveEntryKind,
  setRecordManualResult,
  type AuditTrailEvent,
  type RecordEntry,
  type RecordItem,
} from '../api/record';
import { useAuthStore } from '../stores/auth';
import { formatDateTime } from '../utils/displayLabels';
import EntryReviewCard from './EntryReviewCard';

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  submitted: { color: 'processing', text: '待审核' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已驳回' },
  archived: { color: 'default', text: '已归档' },
};

const TRAIL_LABEL: Record<string, string> = {
  submitted: '提交',
  resubmitted: '重新提交',
  auto_approved: 'AI 合格自动通过',
  approved: '管理员通过',
  rejected: '管理员驳回',
  reopened: '返工打开',
  manual_result: '人工确认检查项',
};

function trailColor(action: string) {
  if (action === 'rejected') return 'red';
  if (action === 'approved' || action === 'auto_approved') return 'green';
  if (action === 'resubmitted' || action === 'reopened') return 'orange';
  return 'blue';
}

export function recordUnitTitle(row: RecordItem) {
  if (row.workUnit) {
    const label = row.unitLabel || '台';
    return `${label} #${row.workUnit.seq}`;
  }
  return row.task?.taskName || '-';
}

function withEntryAnalyzing(record: RecordItem, templateEntryId: string): RecordItem {
  const entries = record.entries.map((entry) =>
    entry.templateEntryId === templateEntryId
      ? {
          ...entry,
          aiResult: { status: 'pending', confidence: 0, reason: '重新分析中…' },
          finalResult: null,
        }
      : entry,
  );
  const aiSummary = entries.reduce(
    (summary, entry) => {
      const status = entry.aiResult?.status || 'pending';
      if (status === 'pass') summary.pass += 1;
      else if (status === 'fail') summary.fail += 1;
      else if (status === 'error') summary.error += 1;
      else summary.pending += 1;
      return summary;
    },
    { pass: 0, fail: 0, pending: 0, error: 0 },
  );
  return { ...record, entries, aiSummary };
}

type Props = {
  open: boolean;
  record: RecordItem | null;
  onClose: () => void;
  /** 详情刷新后回调（用于同步外层台次列表） */
  onRecordChange?: (fresh: RecordItem) => void;
};

export default function RecordDetailDrawer({
  open,
  record,
  onClose,
  onRecordChange,
}: Props) {
  const role = useAuthStore((s) => s.user?.role);
  const canManualConfirm = role === 'super_admin' || role === 'site_manager';
  const [detail, setDetail] = useState<RecordItem | null>(record);
  const [retryingEntryId, setRetryingEntryId] = useState<string>();
  const [manualBusyKey, setManualBusyKey] = useState<string>();

  useEffect(() => {
    setDetail(record);
  }, [record]);

  useEffect(() => {
    if (!open || !detail?.aiSummary?.pending) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || !detail) return;
      refreshing = true;
      try {
        const fresh = await fetchRecord(detail.id);
        if (disposed) return;
        setDetail(fresh);
        onRecordChange?.(fresh);
      } catch {
        // ignore transient errors
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [open, detail?.id, detail?.aiSummary?.pending, onRecordChange]);

  const applyFresh = (fresh: RecordItem) => {
    setDetail(fresh);
    onRecordChange?.(fresh);
  };

  const tplName = (rec: RecordItem, templateEntryId: string) =>
    rec.task?.templateSnapshot?.find((e) => e.id === templateEntryId)?.name ||
    templateEntryId.slice(0, 8);

  const trailItems = (events?: AuditTrailEvent[]) =>
    (events || [])
      .slice()
      .reverse()
      .map((ev, idx) => ({
        key: `${ev.at}-${idx}`,
        color: trailColor(ev.action),
        children: (
          <div>
            <div style={{ fontWeight: 600 }}>
              {TRAIL_LABEL[ev.action] || '其他操作'}
              {ev.byName ? ` · ${ev.byName}` : ''}
            </div>
            <div style={{ color: '#888', fontSize: 12 }}>
              {ev.at ? formatDateTime(ev.at) : ''}
            </div>
            {ev.summary ? <div style={{ marginTop: 4 }}>{ev.summary}</div> : null}
            {ev.reason ? (
              <div style={{ marginTop: 4, color: '#a8071a' }}>原因：{ev.reason}</div>
            ) : null}
          </div>
        ),
      }));

  const retryAnalysis = async (entry: RecordEntry) => {
    if (!detail || !entry.photos?.length) {
      message.warning('该检查项没有现场照片，无法重新分析');
      return;
    }
    const template = detail.task?.templateSnapshot?.find(
      (item) => item.id === entry.templateEntryId,
    );
    if (resolveEntryKind(template || {}) === 'record') {
      message.info('记录类条目不需要 AI 分析');
      return;
    }
    setRetryingEntryId(entry.templateEntryId);
    const analyzing = withEntryAnalyzing(detail, entry.templateEntryId);
    applyFresh(analyzing);
    message.info('已开始重新分析，结果会自动刷新');
    try {
      await analyzeAi({
        recordId: detail.id,
        templateEntryId: entry.templateEntryId,
        photoUrls: entry.photos,
        samplePhotoUrls: template?.samplePhotos || [],
      });
      const fresh = await fetchRecord(detail.id);
      applyFresh(fresh);
      message.success('重新分析已完成');
    } catch {
      try {
        const fresh = await fetchRecord(detail.id);
        applyFresh(fresh);
        const current = fresh.entries.find(
          (item) => item.templateEntryId === entry.templateEntryId,
        );
        if (current?.aiResult?.status === 'pending') {
          message.warning('请求等待超时，后台仍在分析，页面会继续自动刷新');
        } else if (current?.aiResult?.status !== entry.aiResult?.status) {
          message.success('重新分析已完成');
        } else {
          message.error('重新分析未能启动，请稍后重试');
        }
      } catch {
        message.warning('网络暂时不可用，页面恢复连接后会继续查询分析结果');
      }
    } finally {
      setRetryingEntryId(undefined);
    }
  };

  const handleManualConfirm = (entry: RecordEntry, result: 'pass' | 'fail') => {
    if (!detail || !canManualConfirm) return;
    const label = result === 'pass' ? '合格' : '不合格';
    const busyKey = `${entry.templateEntryId}:${result}`;
    Modal.confirm({
      title: `确认设为${label}`,
      content: `将该检查项最终结论设为「${label}」？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setManualBusyKey(busyKey);
        try {
          const fresh = await setRecordManualResult(
            detail.id,
            entry.templateEntryId,
            result,
          );
          applyFresh(fresh);
          message.success(`已人工确认${label}`);
        } catch (error: any) {
          message.error(error?.message || '操作失败');
        } finally {
          setManualBusyKey(undefined);
        }
      },
    });
  };

  return (
    <Drawer
      title={
        detail
          ? `${detail.gspCaseNo ? `${detail.gspCaseNo} · ` : ''}${recordUnitTitle(detail)}`
          : '记录详情'
      }
      width={760}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {detail ? (
        <>
          <div style={{ marginBottom: 12, color: '#666' }}>
            工程师：{detail.inspectorName || '-'}
            {detail.submittedAt
              ? ` · 提交于 ${formatDateTime(detail.submittedAt)}`
              : ''}
          </div>
          <div style={{ marginBottom: 20 }}>
            <Tag color={STATUS_MAP[detail.status]?.color}>
              {STATUS_MAP[detail.status]?.text || '未知状态'}
            </Tag>
            {detail.aiSummary ? (
              <Tag style={{ marginLeft: 8 }}>
                AI 合格 {detail.aiSummary.pass} / 不合格 {detail.aiSummary.fail} / 异常{' '}
                {detail.aiSummary.error ?? 0} / 分析中 {detail.aiSummary.pending}
              </Tag>
            ) : null}
          </div>

          {detail.location ? (
            <div
              style={{
                marginBottom: 24,
                padding: '12px 14px',
                background:
                  detail.location.status === 'failed' ||
                  detail.location.status === 'skipped'
                    ? '#fff2f0'
                    : detail.location.status === 'weak'
                      ? '#fffbe6'
                      : '#f6ffed',
                border: `1px solid ${
                  detail.location.status === 'failed' ||
                  detail.location.status === 'skipped'
                    ? '#ffccc7'
                    : detail.location.status === 'weak'
                      ? '#ffe58f'
                      : '#b7eb8f'
                }`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                现场定位
                {detail.location.status === 'failed' ||
                detail.location.status === 'skipped' ? (
                  <Tag color="error" style={{ marginLeft: 8 }}>
                    位置异常
                  </Tag>
                ) : detail.location.status === 'weak' ? (
                  <Tag color="warning" style={{ marginLeft: 8 }}>
                    弱定位
                  </Tag>
                ) : detail.location.latitude != null ? (
                  <Tag color="success" style={{ marginLeft: 8 }}>
                    正常
                  </Tag>
                ) : null}
              </div>
              {detail.location.latitude != null && detail.location.longitude != null ? (
                <div>
                  经纬度：{Number(detail.location.latitude).toFixed(6)},{' '}
                  {Number(detail.location.longitude).toFixed(6)}
                </div>
              ) : (
                <div style={{ color: '#a8071a' }}>
                  {detail.location.reason ||
                    (detail.location.status === 'skipped'
                      ? '工程师确认无法定位后继续作业'
                      : '未能获取现场定位')}
                </div>
              )}
              {detail.location.address ? (
                <div style={{ marginTop: 4 }}>地址：{detail.location.address}</div>
              ) : null}
              <div style={{ marginTop: 4, color: '#666', fontSize: 12 }}>
                {detail.location.accuracyMeters != null && detail.location.accuracyMeters > 0
                  ? `精度约 ${detail.location.accuracyMeters} 米`
                  : ''}
                {detail.location.distanceToSiteMeters != null
                  ? ` · 距归属网格约 ${detail.location.distanceToSiteMeters} 米`
                  : ''}
                {detail.location.capturedAt
                  ? ` · ${formatDateTime(detail.location.capturedAt)}`
                  : ''}
                {detail.location.reason && detail.location.latitude != null
                  ? ` · ${detail.location.reason}`
                  : ''}
              </div>
            </div>
          ) : null}

          <div style={{ fontWeight: 600, marginBottom: 12 }}>操作追溯</div>
          {(detail.auditTrail || []).length ? (
            <Timeline items={trailItems(detail.auditTrail)} style={{ marginBottom: 24 }} />
          ) : (
            <div style={{ color: '#999', marginBottom: 24 }}>暂无追溯记录（旧数据）</div>
          )}

          <div style={{ fontWeight: 600, marginBottom: 12 }}>检查项</div>
          {detail.entries?.map((entry) => {
            const tpl = detail.task?.templateSnapshot?.find(
              (item) => item.id === entry.templateEntryId,
            );
            const isRecord = resolveEntryKind(tpl || {}) === 'record';
            return (
              <EntryReviewCard
                key={entry.templateEntryId}
                title={tplName(detail, entry.templateEntryId)}
                entry={entry}
                photoSize={104}
                showAi={!isRecord}
                canConfirm={
                  canManualConfirm &&
                  ['submitted', 'approved', 'rejected'].includes(detail.status)
                }
                manualBusy={
                  manualBusyKey === `${entry.templateEntryId}:pass`
                    ? 'pass'
                    : manualBusyKey === `${entry.templateEntryId}:fail`
                      ? 'fail'
                      : null
                }
                retrying={retryingEntryId === entry.templateEntryId}
                onConfirm={(result) => handleManualConfirm(entry, result)}
                onRetry={() => void retryAnalysis(entry)}
              />
            );
          })}
        </>
      ) : null}
    </Drawer>
  );
}
