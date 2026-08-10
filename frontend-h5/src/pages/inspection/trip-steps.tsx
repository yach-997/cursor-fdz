import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Button, Toast } from 'react-vant';
import {
  ocrUnitMileage,
  saveUnitTripExpense,
  uploadFinanceWorkPhoto,
  type TripExpenseClaim,
} from '../../api/finance';
import { displayPhotoUrl } from '../../utils/photo-url';
import { compressImage } from '../../utils/imageCompress';

export type TripMode = 'undecided' | 'skip' | 'need' | 'na';

export type TripFormState = {
  startOdometerUrl: string;
  startNavUrls: string[];
  startMileage: string;
  endOdometerUrl: string;
  endNavUrls: string[];
  endMileage: string;
  amount: string;
  voucherUrls: string[];
  note: string;
};

export const emptyTripForm = (): TripFormState => ({
  startOdometerUrl: '',
  startNavUrls: [],
  startMileage: '',
  endOdometerUrl: '',
  endNavUrls: [],
  endMileage: '',
  amount: '',
  voucherUrls: [],
  note: '',
});

function navUrlsFromClaim(
  urls?: string[] | null,
  legacy?: string | null,
): string[] {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (list.length) return list;
  return legacy ? [legacy] : [];
}

export function tripFormFromClaim(claim?: TripExpenseClaim | null): TripFormState {
  if (!claim) return emptyTripForm();
  return {
    startOdometerUrl: claim.startOdometerUrl || '',
    startNavUrls: navUrlsFromClaim(claim.startNavUrls, claim.startNavUrl),
    startMileage: claim.startMileage != null ? String(claim.startMileage) : '',
    endOdometerUrl: claim.endOdometerUrl || '',
    endNavUrls: navUrlsFromClaim(claim.endNavUrls, claim.endNavUrl),
    endMileage: claim.endMileage != null ? String(claim.endMileage) : '',
    amount:
      claim.claimAmount != null && Number(claim.claimAmount)
        ? String(Number(claim.claimAmount))
        : claim.amount != null && Number(claim.amount)
          ? String(Number(claim.amount))
          : '',
    voucherUrls: claim.voucherUrls || [],
    note: claim.note || '',
  };
}

export function resolveTripMode(claim?: TripExpenseClaim | null): TripMode {
  if (!claim) return 'undecided';
  if (claim.tripSkipped) return 'skip';
  const nav = navUrlsFromClaim(claim.startNavUrls, claim.startNavUrl);
  const hasStart = !!(
    claim.startOdometerUrl &&
    nav.length &&
    claim.startMileage != null &&
    claim.startMileage !== ''
  );
  if (hasStart) return 'need';
  return 'undecided';
}

export function isStartTripReady(form: TripFormState) {
  return !!(
    form.startOdometerUrl &&
    form.startNavUrls.length &&
    form.startMileage !== '' &&
    Number.isFinite(Number(form.startMileage))
  );
}

export function isEndTripReady(form: TripFormState) {
  if (!form.endOdometerUrl || !form.endNavUrls.length) return false;
  if (form.endMileage === '' || !Number.isFinite(Number(form.endMileage))) return false;
  if (Number(form.amount) > 0 && !form.voucherUrls.length) return false;
  return true;
}

type SlotKey = 'startOdo' | 'startNav' | 'endOdo' | 'endNav' | 'voucher';

function TripThumb({
  url,
  onPreview,
  onRemove,
}: {
  url: string;
  onPreview: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="inspection-photo-thumb trip-inline-thumb">
      <button type="button" className="trip-inline-thumb-btn" onClick={onPreview}>
        <img src={displayPhotoUrl(url)} alt="" />
      </button>
      {onRemove && (
        <button type="button" className="inspection-photo-remove" onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

export function TripChoiceCard({
  busy,
  onNeed,
  onSkip,
}: {
  busy?: boolean;
  onNeed: () => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<'need' | 'skip' | null>(null);

  return (
    <div className="trip-wizard-card">
      <h3>本台是否有行程报销？</h3>
      <p>
        先点选一项，再点下方「确认并继续」。有行程会在产品线前后加上开始/结束行程步骤。
      </p>
      <div className="trip-wizard-choice">
        <button
          type="button"
          className={picked === 'need' ? 'is-primary' : ''}
          disabled={busy}
          onClick={() => setPicked('need')}
        >
          <strong>有行程</strong>
          <span>开始里程 → 产品线 → 结束里程与费用</span>
        </button>
        <button
          type="button"
          className={picked === 'skip' ? 'is-primary' : ''}
          disabled={busy}
          onClick={() => setPicked('skip')}
        >
          <strong>无行程</strong>
          <span>直接进入产品线流程</span>
        </button>
      </div>
      <button
        type="button"
        className="trip-wizard-confirm"
        disabled={busy || !picked}
        onClick={() => {
          if (picked === 'need') onNeed();
          else if (picked === 'skip') onSkip();
        }}
      >
        {busy ? '处理中…' : picked ? '确认并继续' : '请先选择有行程或无行程'}
      </button>
    </div>
  );
}

type TripPanelsProps = {
  caseId: string;
  unitId: string;
  form: TripFormState;
  setForm: Dispatch<SetStateAction<TripFormState>>;
  readonly?: boolean;
  onPreview: (urls: string[], index: number) => void;
};

async function uploadOne(caseId: string, file: File) {
  const compressed = await compressImage(file);
  const res = await uploadFinanceWorkPhoto(caseId, compressed);
  return res?.url || '';
}

function SlotUploadBar({
  caseId,
  slot,
  multi,
  disabled,
  onUploaded,
}: {
  caseId: string;
  slot: SlotKey;
  multi?: boolean;
  disabled?: boolean;
  onUploaded: (urls: string[], slot: SlotKey) => void;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async (files: File[]) => {
    if (!files.length || disabled) return;
    setBusy(true);
    try {
      const list = multi ? files.slice(0, 12) : [files[0]];
      const urls: string[] = [];
      for (const f of list) {
        const url = await uploadOne(caseId, f);
        if (url) urls.push(url);
      }
      if (!urls.length) {
        Toast.fail('上传失败');
        return;
      }
      onUploaded(urls, slot);
      Toast.success(multi ? `已上传 ${urls.length} 张` : '已上传');
    } catch {
      Toast.fail('上传失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inspection-upload-actions" style={{ marginTop: 8 }}>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run([f]);
          e.target.value = '';
        }}
      />
      <input
        ref={galRef}
        type="file"
        accept="image/*"
        multiple={!!multi}
        hidden
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          if (list.length) void run(list);
          e.target.value = '';
        }}
      />
      <Button
        plain
        round
        size="small"
        loading={busy}
        disabled={disabled || busy}
        onClick={() => galRef.current?.click()}
      >
        相册{multi ? '（可多选）' : ''}
      </Button>
      <Button
        type="primary"
        round
        size="small"
        loading={busy}
        disabled={disabled || busy}
        onClick={() => camRef.current?.click()}
      >
        拍照
      </Button>
    </div>
  );
}

export function TripStartPanel({
  caseId,
  unitId,
  form,
  setForm,
  readonly,
  onPreview,
}: TripPanelsProps) {
  const [ocrBusy, setOcrBusy] = useState(false);

  const runOcr = async (url: string) => {
    setOcrBusy(true);
    try {
      const res = await ocrUnitMileage(caseId, unitId, url, 'start');
      if (res.mileage != null) {
        setForm((p) => ({ ...p, startMileage: String(res.mileage) }));
        Toast.success(`识别里程 ${res.mileage} km`);
      } else Toast.info('未识别到里程，请手填');
    } catch {
      Toast.info('识别失败，请手填');
    } finally {
      setOcrBusy(false);
    }
  };

  return (
    <div className="trip-wizard-card">
      <h3>开始行程</h3>
      <p>上传开始里程表与导航截图，确认里程后再进入产品线检查项。</p>

      <div className="trip-wizard-block">
        <strong>开始里程表（单张）</strong>
        <div className="inspection-photo-grid">
          {form.startOdometerUrl ? (
            <TripThumb
              url={form.startOdometerUrl}
              onPreview={() => onPreview([form.startOdometerUrl], 0)}
              onRemove={
                readonly
                  ? undefined
                  : () => setForm((p) => ({ ...p, startOdometerUrl: '', startMileage: '' }))
              }
            />
          ) : (
            <div className="inspection-photo-placeholder">
              <strong>＋</strong>
              <span>里程表</span>
            </div>
          )}
        </div>
        {!readonly && (
          <SlotUploadBar
            caseId={caseId}
            slot="startOdo"
            onUploaded={(urls) => {
              const url = urls[0];
              setForm((p) => ({ ...p, startOdometerUrl: url }));
              void runOcr(url);
            }}
          />
        )}
        {form.startOdometerUrl && !readonly && (
          <Button
            plain
            size="small"
            loading={ocrBusy}
            style={{ marginTop: 8 }}
            onClick={() => void runOcr(form.startOdometerUrl)}
          >
            重新识别里程
          </Button>
        )}
        <label className="trip-wizard-field">
          <span>开始里程（km）</span>
          <input
            inputMode="decimal"
            value={form.startMileage}
            disabled={readonly}
            placeholder="识别后可改"
            onChange={(e) => setForm((p) => ({ ...p, startMileage: e.target.value }))}
          />
        </label>
      </div>

      <div className="trip-wizard-block">
        <strong>导航截图（可多张）</strong>
        <div className="inspection-photo-grid">
          {form.startNavUrls.map((u, idx) => (
            <TripThumb
              key={`${u}-${idx}`}
              url={u}
              onPreview={() => onPreview(form.startNavUrls, idx)}
              onRemove={
                readonly
                  ? undefined
                  : () =>
                      setForm((p) => ({
                        ...p,
                        startNavUrls: p.startNavUrls.filter((_, i) => i !== idx),
                      }))
              }
            />
          ))}
          {!form.startNavUrls.length && (
            <div className="inspection-photo-placeholder">
              <strong>＋</strong>
              <span>导航</span>
            </div>
          )}
        </div>
        {!readonly && form.startNavUrls.length < 12 && (
          <SlotUploadBar
            caseId={caseId}
            slot="startNav"
            multi
            onUploaded={(urls) =>
              setForm((p) => ({
                ...p,
                startNavUrls: [...p.startNavUrls, ...urls].slice(0, 12),
              }))
            }
          />
        )}
      </div>
    </div>
  );
}

export function TripEndPanel({
  caseId,
  unitId,
  form,
  setForm,
  readonly,
  onPreview,
}: TripPanelsProps) {
  const [ocrBusy, setOcrBusy] = useState(false);
  const mileageDiff = (() => {
    const s = Number(form.startMileage);
    const e = Number(form.endMileage);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
    return Math.round((e - s) * 10) / 10;
  })();

  const runOcr = async (url: string) => {
    setOcrBusy(true);
    try {
      const res = await ocrUnitMileage(caseId, unitId, url, 'end');
      if (res.mileage != null) {
        setForm((p) => ({ ...p, endMileage: String(res.mileage) }));
        Toast.success(`识别里程 ${res.mileage} km`);
      } else Toast.info('未识别到里程，请手填');
    } catch {
      Toast.info('识别失败，请手填');
    } finally {
      setOcrBusy(false);
    }
  };

  return (
    <div className="trip-wizard-card">
      <h3>结束行程与费用</h3>
      <p>结束里程与申报费用同屏填写；有金额请上传凭证。完成后提交报告。</p>

      <div className="trip-wizard-block">
        <strong>结束里程表（单张）</strong>
        <div className="inspection-photo-grid">
          {form.endOdometerUrl ? (
            <TripThumb
              url={form.endOdometerUrl}
              onPreview={() => onPreview([form.endOdometerUrl], 0)}
              onRemove={
                readonly
                  ? undefined
                  : () => setForm((p) => ({ ...p, endOdometerUrl: '', endMileage: '' }))
              }
            />
          ) : (
            <div className="inspection-photo-placeholder">
              <strong>＋</strong>
              <span>里程表</span>
            </div>
          )}
        </div>
        {!readonly && (
          <SlotUploadBar
            caseId={caseId}
            slot="endOdo"
            onUploaded={(urls) => {
              const url = urls[0];
              setForm((p) => ({ ...p, endOdometerUrl: url }));
              void runOcr(url);
            }}
          />
        )}
        {form.endOdometerUrl && !readonly && (
          <Button
            plain
            size="small"
            loading={ocrBusy}
            style={{ marginTop: 8 }}
            onClick={() => void runOcr(form.endOdometerUrl)}
          >
            重新识别里程
          </Button>
        )}
        <label className="trip-wizard-field">
          <span>结束里程（km）</span>
          <input
            inputMode="decimal"
            value={form.endMileage}
            disabled={readonly}
            placeholder="识别后可改"
            onChange={(e) => setForm((p) => ({ ...p, endMileage: e.target.value }))}
          />
        </label>
        {mileageDiff != null && (
          <p className="trip-wizard-diff">
            里程差 <strong>{mileageDiff}</strong> km（审核参考）
          </p>
        )}
      </div>

      <div className="trip-wizard-block">
        <strong>导航截图（可多张）</strong>
        <div className="inspection-photo-grid">
          {form.endNavUrls.map((u, idx) => (
            <TripThumb
              key={`${u}-${idx}`}
              url={u}
              onPreview={() => onPreview(form.endNavUrls, idx)}
              onRemove={
                readonly
                  ? undefined
                  : () =>
                      setForm((p) => ({
                        ...p,
                        endNavUrls: p.endNavUrls.filter((_, i) => i !== idx),
                      }))
              }
            />
          ))}
          {!form.endNavUrls.length && (
            <div className="inspection-photo-placeholder">
              <strong>＋</strong>
              <span>导航</span>
            </div>
          )}
        </div>
        {!readonly && form.endNavUrls.length < 12 && (
          <SlotUploadBar
            caseId={caseId}
            slot="endNav"
            multi
            onUploaded={(urls) =>
              setForm((p) => ({
                ...p,
                endNavUrls: [...p.endNavUrls, ...urls].slice(0, 12),
              }))
            }
          />
        )}
      </div>

      <div className="trip-wizard-block">
        <strong>报销费用（同屏）</strong>
        <label className="trip-wizard-field">
          <span>申报金额（元）</span>
          <input
            inputMode="decimal"
            value={form.amount}
            disabled={readonly}
            placeholder="没有费用填 0"
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
          />
        </label>
        <p className="trip-wizard-hint">自己加总后填一个数；最终以管理员核定为准。</p>
        <div className="inspection-photo-grid">
          {form.voucherUrls.map((u, idx) => (
            <TripThumb
              key={`${u}-${idx}`}
              url={u}
              onPreview={() => onPreview(form.voucherUrls, idx)}
              onRemove={
                readonly
                  ? undefined
                  : () =>
                      setForm((p) => ({
                        ...p,
                        voucherUrls: p.voucherUrls.filter((_, i) => i !== idx),
                      }))
              }
            />
          ))}
          {!form.voucherUrls.length && (
            <div className="inspection-photo-placeholder">
              <strong>＋</strong>
              <span>费用凭证</span>
            </div>
          )}
        </div>
        {!readonly && form.voucherUrls.length < 20 && (
          <SlotUploadBar
            caseId={caseId}
            slot="voucher"
            multi
            onUploaded={(urls) =>
              setForm((p) => ({
                ...p,
                voucherUrls: [...p.voucherUrls, ...urls].slice(0, 20),
              }))
            }
          />
        )}
        <label className="trip-wizard-field">
          <span>备注</span>
          <textarea
            rows={2}
            value={form.note}
            disabled={readonly}
            placeholder="可选"
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />
        </label>
      </div>
    </div>
  );
}

export async function persistTripSkip(caseId: string, unitId: string) {
  return saveUnitTripExpense(caseId, unitId, {
    tripSkipped: true,
    amount: 0,
    voucherUrls: [],
  });
}

export async function persistTripStart(
  caseId: string,
  unitId: string,
  form: TripFormState,
) {
  return saveUnitTripExpense(caseId, unitId, {
    tripSkipped: false,
    startOdometerUrl: form.startOdometerUrl || null,
    startNavUrls: form.startNavUrls,
    startNavUrl: form.startNavUrls[0] || null,
    startMileage: form.startMileage === '' ? null : Number(form.startMileage),
  });
}

export async function persistTripEnd(
  caseId: string,
  unitId: string,
  form: TripFormState,
  submitFee: boolean,
) {
  // 开始资料可能已在开工时落库；结束保存只带非空开始字段，避免空值把已上传的开始图冲掉
  return saveUnitTripExpense(caseId, unitId, {
    tripSkipped: false,
    ...(form.startOdometerUrl ? { startOdometerUrl: form.startOdometerUrl } : {}),
    ...(form.startNavUrls.length
      ? { startNavUrls: form.startNavUrls, startNavUrl: form.startNavUrls[0] }
      : {}),
    ...(form.startMileage !== ''
      ? { startMileage: Number(form.startMileage) }
      : {}),
    endOdometerUrl: form.endOdometerUrl || null,
    endNavUrls: form.endNavUrls,
    endNavUrl: form.endNavUrls[0] || null,
    endMileage: form.endMileage === '' ? null : Number(form.endMileage),
    amount: Number(form.amount) || 0,
    voucherUrls: form.voucherUrls,
    note: form.note,
    submit: submitFee && Number(form.amount) > 0,
  });
}
