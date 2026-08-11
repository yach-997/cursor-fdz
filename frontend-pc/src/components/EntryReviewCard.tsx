import { Button, Image, Space, Tag } from 'antd';
import type { RecordEntry } from '../api/record';
import { displayPhotoUrl } from '../utils/photo-url';
import './EntryReviewCard.css';

function aiTagView(entry: RecordEntry) {
  const status = entry.aiResult?.status || 'pending';
  const confidence = Math.round((entry.aiResult?.confidence || 0) * 100);
  if (status === 'pass') {
    return { label: `AI分析：合格 ${confidence}%`, color: 'success' as const };
  }
  if (status === 'fail') {
    return { label: `AI分析：不合格 ${confidence}%`, color: 'error' as const };
  }
  if (status === 'error') {
    return { label: 'AI分析：异常', color: 'warning' as const };
  }
  return { label: 'AI分析：进行中', color: 'processing' as const };
}

function manualSelected(entry: RecordEntry): 'pass' | 'fail' | null {
  if (entry.manualResult === 'pass' || entry.manualResult === 'fail') {
    return entry.manualResult;
  }
  return null;
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

/** 检查项：右上 AI 结论；左下人工确认（绿/红描边统一） */
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
  const ai = aiTagView(entry);
  const selected = manualSelected(entry);
  const reason = entry.aiResult?.reason?.trim();
  const photos = entry.photos || [];
  const aiStatus = entry.aiResult?.status;
  const manualOverridesAi =
    selected &&
    (aiStatus === 'pass' || aiStatus === 'fail') &&
    selected !== aiStatus;

  return (
    <div className="entry-review-card">
      <div className="entry-review-card__head">
        <div className="entry-review-card__title">
          <span>{title}</span>
          {needRedo ? <Tag color="error">需返工</Tag> : null}
        </div>
        <Tag color={ai.color} className="entry-review-card__ai-tag">
          {ai.label}
        </Tag>
      </div>

      {reason ? <div className="entry-review-card__reason">{reason}</div> : null}

      {selected ? (
        <div
          className={`entry-review-card__manual-tip ${
            selected === 'fail' ? 'is-fail' : 'is-pass'
          }`}
        >
          人工已确认：{selected === 'pass' ? '合格' : '不合格'}
          {manualOverridesAi ? '（最终以人工为准）' : ''}
        </div>
      ) : null}

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
          <div className="entry-review-card__confirm">
            <span className="entry-review-card__confirm-label">点击可人工确认</span>
            <div className="entry-review-card__toggle">
              <Button
                size="small"
                className={`entry-btn-pass${selected === 'pass' ? ' is-active' : ''}`}
                loading={manualBusy === 'pass'}
                onClick={() => onConfirm?.('pass')}
              >
                合格
              </Button>
              <Button
                size="small"
                className={`entry-btn-fail${selected === 'fail' ? ' is-active' : ''}`}
                loading={manualBusy === 'fail'}
                onClick={() => onConfirm?.('fail')}
              >
                不合格
              </Button>
            </div>
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
