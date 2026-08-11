import { Button, Image, Space, Tag } from 'antd';
import type { RecordEntry } from '../api/record';
import { displayPhotoUrl } from '../utils/photo-url';
import { CHECK_RESULT_LABEL } from '../utils/displayLabels';
import './EntryReviewCard.css';

function finalView(entry: RecordEntry) {
  const manual =
    entry.manualResult === 'pass' || entry.manualResult === 'fail' ? entry.manualResult : null;
  if (entry.finalResult === 'pass') {
    return {
      label: manual === 'pass' ? '合格 · 人工' : '合格',
      color: 'success' as const,
    };
  }
  if (entry.finalResult === 'fail') {
    return {
      label: manual === 'fail' ? '不合格 · 人工' : '不合格',
      color: 'error' as const,
    };
  }
  if (entry.aiResult?.status === 'error') {
    return { label: '待判断', color: 'warning' as const };
  }
  return { label: '分析中', color: 'processing' as const };
}

export type EntryReviewCardProps = {
  title: string;
  entry: RecordEntry;
  needRedo?: boolean;
  canConfirm?: boolean;
  photoSize?: number;
  manualBusy?: 'pass' | 'fail' | null;
  retrying?: boolean;
  onConfirm?: (result: 'pass' | 'fail') => void;
  onRetry?: () => void;
};

/** 检查项：结论一眼可见，操作收成短按钮 */
export default function EntryReviewCard({
  title,
  entry,
  needRedo,
  canConfirm,
  photoSize = 96,
  manualBusy,
  retrying,
  onConfirm,
  onRetry,
}: EntryReviewCardProps) {
  const final = finalView(entry);
  const aiStatus = entry.aiResult?.status || 'pending';
  const aiLabel = CHECK_RESULT_LABEL[aiStatus] || '待人工判断';
  const confidence = Math.round((entry.aiResult?.confidence || 0) * 100);
  const reason = entry.aiResult?.reason?.trim();
  const photos = entry.photos || [];
  const selected =
    entry.manualResult === 'pass' || entry.manualResult === 'fail'
      ? entry.manualResult
      : entry.finalResult === 'pass' || entry.finalResult === 'fail'
        ? entry.finalResult
        : null;

  return (
    <div className="entry-review-card">
      <div className="entry-review-card__head">
        <div className="entry-review-card__title">
          <span>{title}</span>
          {needRedo ? <Tag color="error">需返工</Tag> : null}
        </div>
        <Tag color={final.color} className="entry-review-card__final">
          {final.label}
        </Tag>
      </div>

      <div className="entry-review-card__ai">
        <span>
          AI {aiLabel}
          {['pass', 'fail'].includes(aiStatus) ? ` ${confidence}%` : ''}
        </span>
        {reason ? <span className="entry-review-card__reason">{reason}</span> : null}
      </div>

      {photos.length > 0 ? (
        <Image.PreviewGroup>
          <Space wrap size={8} className="entry-review-card__photos">
            {photos.map((url) => (
              <Image
                key={url}
                src={displayPhotoUrl(url)}
                width={photoSize}
                height={photoSize}
                style={{ objectFit: 'cover', borderRadius: 8 }}
              />
            ))}
          </Space>
        </Image.PreviewGroup>
      ) : (
        <div className="entry-review-card__empty">暂无现场照片</div>
      )}

      {canConfirm ? (
        <div className="entry-review-card__actions">
          <div className="entry-review-card__toggle">
            <Button
              size="small"
              type={selected === 'pass' ? 'primary' : 'default'}
              loading={manualBusy === 'pass'}
              onClick={() => onConfirm?.('pass')}
            >
              合格
            </Button>
            <Button
              size="small"
              danger={selected !== 'fail'}
              type={selected === 'fail' ? 'primary' : 'default'}
              loading={manualBusy === 'fail'}
              onClick={() => onConfirm?.('fail')}
            >
              不合格
            </Button>
          </div>
          {photos.length > 0 ? (
            <Button type="link" size="small" loading={retrying} onClick={onRetry}>
              重新分析
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
