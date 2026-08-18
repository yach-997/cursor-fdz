import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loading, Toast, ActionSheet, DatetimePicker } from 'react-vant';
import {
  completeFinanceUnit,
  fetchMyFinanceCase,
  finishFinanceCase,
  ocrMyMileage,
  saveMyTripExpense,
  uploadFinanceWorkPhoto,
  type ExpenseLineItem,
  type ExpenseNavShot,
  type MobileFinanceCase,
  type TripExpenseClaim,
} from '../../api/finance';
import { useAuthStore } from '../../stores/auth';
import PhotoViewerOverlay from '../../components/PhotoViewerOverlay';
import { displayPhotoUrl } from '../../utils/photo-url';
import { compressImage } from '../../utils/imageCompress';
import './finance.css';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  submitted: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const DATE_MIN = new Date(2020, 0, 1);
const DATE_MAX = new Date(2035, 11, 31);

/** 统一成 YYYY-MM-DD，兼容 ISO / 斜杠日期 */
function toDateValue(raw?: string | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function parseDateValue(value: string): Date {
  const v = toDateValue(value);
  if (!v) return new Date();
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateLabel(value: string): string {
  const v = toDateValue(value);
  if (!v) return '';
  const [y, m, d] = v.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function ExpenseDateField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = formatDateLabel(value);

  return (
    <>
      <button
        type="button"
        className="trip-date-trigger"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
      >
        <span className={label ? 'is-value' : 'is-placeholder'}>
          {label || '请选择日期'}
        </span>
        <span className="trip-date-chevron" aria-hidden>
          ▾
        </span>
      </button>
      <DatetimePicker
        popup={{ round: true }}
        type="date"
        title="选择日期"
        visible={open}
        value={parseDateValue(value)}
        minDate={DATE_MIN}
        maxDate={DATE_MAX}
        confirmButtonText="确定"
        cancelButtonText="取消"
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onConfirm={(date: Date) => {
          onChange(formatDateValue(date));
          setOpen(false);
        }}
      />
    </>
  );
}

type LineType = 'trip' | 'toll' | 'other';

type DraftLine = {
  id: string;
  type: LineType;
  content: string;
  expenseDate: string;
  amount: string;
  note: string;
  startOdometerUrl: string;
  startMileage: string;
  startNavShots: ExpenseNavShot[];
  endOdometerUrl: string;
  endMileage: string;
  endNavShots: ExpenseNavShot[];
  voucherUrls: string[];
  photoUrls: string[];
};

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const emptyLine = (type: LineType = 'toll'): DraftLine => ({
  id: newId(),
  type,
  content: type === 'trip' ? '行程' : type === 'toll' ? '过路费' : '',
  expenseDate: '',
  amount: '',
  note: '',
  startOdometerUrl: '',
  startMileage: '',
  startNavShots: [],
  endOdometerUrl: '',
  endMileage: '',
  endNavShots: [],
  voucherUrls: [],
  photoUrls: [],
});

const shotsFromUrls = (urls: string[], remarks?: string[]): ExpenseNavShot[] =>
  (urls || []).filter(Boolean).map((url, i) => ({
    url,
    remark: remarks?.[i] || '',
  }));

function claimToLines(claim?: TripExpenseClaim | null): DraftLine[] {
  if (!claim) return [emptyLine('trip')];
  const raw = Array.isArray(claim.lineItems) ? claim.lineItems : [];
  if (raw.length) {
    return raw.map((item) => lineFromApi(item));
  }
  // 兼容旧数据：合成一条行程明细
  const hasTrip =
    !!claim.startOdometerUrl ||
    !!claim.endOdometerUrl ||
    (claim.startNavUrls && claim.startNavUrls.length > 0) ||
    !!claim.startNavUrl ||
    Number(claim.claimAmount ?? claim.amount) > 0;
  if (!hasTrip || claim.tripSkipped) return [emptyLine('trip')];
  return [
    {
      ...emptyLine('trip'),
      startOdometerUrl: claim.startOdometerUrl || '',
      startMileage: claim.startMileage != null ? String(claim.startMileage) : '',
      startNavShots: shotsFromUrls(
        claim.startNavUrls?.length
          ? claim.startNavUrls
          : claim.startNavUrl
            ? [claim.startNavUrl]
            : [],
      ),
      endOdometerUrl: claim.endOdometerUrl || '',
      endMileage: claim.endMileage != null ? String(claim.endMileage) : '',
      endNavShots: shotsFromUrls(
        claim.endNavUrls?.length
          ? claim.endNavUrls
          : claim.endNavUrl
            ? [claim.endNavUrl]
            : [],
      ),
      voucherUrls: claim.voucherUrls || [],
      amount:
        claim.claimAmount != null || claim.amount != null
          ? String(Number(claim.claimAmount ?? claim.amount) || '')
          : '',
      note: claim.note || '',
    },
  ];
}

function lineFromApi(item: ExpenseLineItem): DraftLine {
  const type: LineType =
    item.type === 'trip' || item.type === 'toll' || item.type === 'other'
      ? item.type
      : 'other';
  return {
    id: item.id || newId(),
    type,
    content:
      type === 'trip'
        ? '行程'
        : type === 'toll'
          ? '过路费'
          : String(item.content || ''),
    expenseDate: toDateValue(item.expenseDate),
    amount:
      item.amount != null && item.amount !== ''
        ? String(Number(item.amount) || '')
        : '',
    note: item.note || '',
    startOdometerUrl: item.startOdometerUrl || '',
    startMileage:
      item.startMileage != null && item.startMileage !== ''
        ? String(item.startMileage)
        : '',
    startNavShots: Array.isArray(item.startNavShots)
      ? item.startNavShots.map((s) => ({ url: s.url, remark: s.remark || '' }))
      : [],
    endOdometerUrl: item.endOdometerUrl || '',
    endMileage:
      item.endMileage != null && item.endMileage !== ''
        ? String(item.endMileage)
        : '',
    endNavShots: Array.isArray(item.endNavShots)
      ? item.endNavShots.map((s) => ({ url: s.url, remark: s.remark || '' }))
      : [],
    voucherUrls: item.voucherUrls || [],
    photoUrls: item.photoUrls || [],
  };
}

function toPayloadLines(lines: DraftLine[]): ExpenseLineItem[] {
  return lines.map((line) => {
    const startM = line.startMileage === '' ? null : Number(line.startMileage);
    const endM = line.endMileage === '' ? null : Number(line.endMileage);
    let mileageKm: number | null = null;
    if (
      startM != null &&
      endM != null &&
      Number.isFinite(startM) &&
      Number.isFinite(endM) &&
      endM >= startM
    ) {
      mileageKm = Math.round((endM - startM) * 10) / 10;
    }
    return {
      id: line.id,
      type: line.type,
      content:
        line.type === 'trip'
          ? '行程'
          : line.type === 'toll'
            ? '过路费'
            : line.content.trim(),
      expenseDate: toDateValue(line.expenseDate) || null,
      amount: Number(line.amount) || 0,
      note: line.note.trim() || null,
      startOdometerUrl: line.startOdometerUrl || null,
      startMileage: startM,
      startNavShots: line.startNavShots,
      endOdometerUrl: line.endOdometerUrl || null,
      endMileage: endM,
      endNavShots: line.endNavShots,
      mileageKm,
      voucherUrls: line.voucherUrls,
      photoUrls: line.photoUrls,
    };
  });
}

export default function FinanceExpensePage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [pickTarget, setPickTarget] = useState<string | null>(null);
  const [pickMulti, setPickMulti] = useState(false);
  const [pickSheetOpen, setPickSheetOpen] = useState(false);

  const [item, setItem] = useState<MobileFinanceCase>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [unitId, setUnitId] = useState(search.get('unitId') || '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null);

  const [lines, setLines] = useState<DraftLine[]>([emptyLine('trip')]);
  const [status, setStatus] = useState('draft');
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [claimAmount, setClaimAmount] = useState<string | null>(null);
  const [approvedAmount, setApprovedAmount] = useState<string | null>(null);

  const unitLabel = item?.unitLabel || '台';
  const isMulti = item?.assignMode === 'multi';

  const applyClaim = (claim?: TripExpenseClaim | null) => {
    setLines(claimToLines(claim));
    if (!claim || claim.tripSkipped) {
      setStatus('draft');
      setReviewNote(null);
      setClaimAmount(null);
      setApprovedAmount(null);
      return;
    }
    setStatus(claim.status || 'draft');
    setReviewNote(claim.reviewNote || null);
    setClaimAmount(claim.claimAmount ?? null);
    setApprovedAmount(claim.status === 'approved' ? claim.amount : null);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const data = await fetchMyFinanceCase(id);
        setItem(data);
        const units = data.units || [];
        const qUnit = search.get('unitId');
        let nextUnit = qUnit || '';
        if (!nextUnit) {
          const mine = units.filter(
            (u) =>
              u.inspectorId === userId &&
              ['claimed', 'submitted', 'completed'].includes(u.status),
          );
          nextUnit = mine[0]?.id || units[0]?.id || '';
        }
        setUnitId(nextUnit);
        const myClaim =
          (data.expenses || []).find((e) => e.inspectorId === userId) ||
          (data.expenses || []).find((e) => e.workUnitId === nextUnit);
        applyClaim(myClaim);
      } catch {
        setItem(undefined);
        setLoadError('费用明细加载失败，请检查网络后重试');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, search, userId, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const readonly = status === 'submitted' || status === 'approved';
  const totalAmount = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
    [lines],
  );

  const updateLine = (lineId: string, patch: Partial<DraftLine>) => {
    setLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    );
  };

  const setLineType = (lineId: string, type: LineType) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        return {
          ...line,
          type,
          content:
            type === 'trip' ? '行程' : type === 'toll' ? '过路费' : '',
        };
      }),
    );
  };

  const addLine = (type: LineType = 'toll') => {
    setLines((prev) => [...prev, emptyLine(type)]);
  };

  const copyLine = (lineId: string) => {
    setLines((prev) => {
      const src = prev.find((l) => l.id === lineId);
      if (!src) return prev;
      return [
        ...prev,
        {
          ...src,
          id: newId(),
          // 复制时不带图，避免误交旧凭证；字段可改
          startOdometerUrl: '',
          startMileage: '',
          startNavShots: [],
          endOdometerUrl: '',
          endMileage: '',
          endNavShots: [],
          voucherUrls: [],
          photoUrls: [],
        },
      ];
    });
  };

  const removeLine = (lineId: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== lineId)));
  };

  const openPick = (target: string, multi = false) => {
    if (readonly || uploading) return;
    setPickTarget(target);
    setPickMulti(multi);
    setPickSheetOpen(true);
  };

  const runFilePick = (mode: 'camera' | 'gallery') => {
    const multi = pickMulti && mode === 'gallery';
    if (mode === 'camera') {
      if (cameraRef.current) {
        cameraRef.current.multiple = false;
        setTimeout(() => cameraRef.current?.click(), 0);
      }
      return;
    }
    if (fileRef.current) {
      fileRef.current.multiple = multi;
      setTimeout(() => fileRef.current?.click(), 0);
    }
  };

  const runOcr = async (lineId: string, imageUrl: string, kind: 'start' | 'end') => {
    setOcrBusy(true);
    try {
      const res = await ocrMyMileage(id, imageUrl, kind);
      if (res.mileage != null) {
        updateLine(
          lineId,
          kind === 'start'
            ? { startMileage: String(res.mileage) }
            : { endMileage: String(res.mileage) },
        );
        Toast.success(`识别里程 ${res.mileage} km`);
      } else {
        Toast.info('未识别到里程数字，请在下方手填');
      }
    } catch {
      Toast.info('识别失败，请手填里程');
    } finally {
      setOcrBusy(false);
    }
  };

  const onPick = async (files: FileList | null) => {
    if (!files?.length || !pickTarget || readonly) return;
    const multi = pickMulti;
    setUploading(true);
    try {
      const list = multi ? Array.from(files).slice(0, 12) : [files[0]];
      const uploaded: string[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const compressed = await compressImage(list[i]);
        const res = await uploadFinanceWorkPhoto(id, compressed);
        const url = res?.url;
        if (!url) continue;
        uploaded.push(url);
      }
      if (!uploaded.length) {
        Toast.fail('上传失败');
        return;
      }

      const [kind, lineId] = pickTarget.split(':');
      if (!lineId) return;

      if (kind === 'startOdo') {
        updateLine(lineId, { startOdometerUrl: uploaded[0], startMileage: '' });
        await runOcr(lineId, uploaded[0], 'start');
      } else if (kind === 'endOdo') {
        updateLine(lineId, { endOdometerUrl: uploaded[0], endMileage: '' });
        await runOcr(lineId, uploaded[0], 'end');
      } else if (kind === 'startNav') {
        setLines((prev) =>
          prev.map((line) =>
            line.id === lineId
              ? {
                  ...line,
                  startNavShots: [
                    ...line.startNavShots,
                    ...uploaded.map((url) => ({ url, remark: '' })),
                  ].slice(0, 12),
                }
              : line,
          ),
        );
        Toast.success(uploaded.length > 1 ? `已上传 ${uploaded.length} 张` : '已上传');
      } else if (kind === 'endNav') {
        setLines((prev) =>
          prev.map((line) =>
            line.id === lineId
              ? {
                  ...line,
                  endNavShots: [
                    ...line.endNavShots,
                    ...uploaded.map((url) => ({ url, remark: '' })),
                  ].slice(0, 12),
                }
              : line,
          ),
        );
        Toast.success(uploaded.length > 1 ? `已上传 ${uploaded.length} 张` : '已上传');
      } else if (kind === 'voucher') {
        setLines((prev) =>
          prev.map((line) =>
            line.id === lineId
              ? {
                  ...line,
                  voucherUrls: [...line.voucherUrls, ...uploaded].slice(0, 20),
                }
              : line,
          ),
        );
        Toast.success(uploaded.length > 1 ? `已上传 ${uploaded.length} 张` : '已上传');
      } else if (kind === 'photo') {
        setLines((prev) =>
          prev.map((line) =>
            line.id === lineId
              ? {
                  ...line,
                  photoUrls: [...line.photoUrls, ...uploaded].slice(0, 20),
                }
              : line,
          ),
        );
        Toast.success(uploaded.length > 1 ? `已上传 ${uploaded.length} 张` : '已上传');
      }
    } catch {
      Toast.fail('上传失败');
    } finally {
      setUploading(false);
      setPickTarget(null);
      setPickMulti(false);
      if (fileRef.current) {
        fileRef.current.value = '';
        fileRef.current.multiple = false;
      }
      if (cameraRef.current) {
        cameraRef.current.value = '';
      }
    }
  };

  const validateDraft = (forSubmit: boolean) => {
    if (!lines.length) {
      Toast.fail('请至少添加一条费用明细');
      return false;
    }
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const n = i + 1;
      if (line.type === 'other' && !line.content.trim()) {
        Toast.fail(`费用明细 ${n}：请填写内容`);
        return false;
      }
      if (forSubmit && !line.expenseDate) {
        Toast.fail(`费用明细 ${n}：请选择日期`);
        return false;
      }
      if (line.type === 'trip') {
        if (forSubmit) {
          if (!line.startOdometerUrl || !line.startNavShots.length) {
            Toast.fail(`费用明细 ${n}：请上传开始里程图和导航截图`);
            return false;
          }
          if (line.startMileage === '' || !Number.isFinite(Number(line.startMileage))) {
            Toast.fail(`费用明细 ${n}：请填写开始里程`);
            return false;
          }
          if (!line.endOdometerUrl || !line.endNavShots.length) {
            Toast.fail(`费用明细 ${n}：请上传结束里程图和导航截图`);
            return false;
          }
          if (line.endMileage === '' || !Number.isFinite(Number(line.endMileage))) {
            Toast.fail(`费用明细 ${n}：请填写结束里程`);
            return false;
          }
          if (Number(line.endMileage) < Number(line.startMileage)) {
            Toast.fail(`费用明细 ${n}：结束里程不能小于开始里程`);
            return false;
          }
          // 行程已有里程/导航作依据，费用凭证可选
        }
      } else if (forSubmit) {
        if (!(Number(line.amount) > 0)) {
          Toast.fail(`费用明细 ${n}：请填写金额`);
          return false;
        }
        if (!line.photoUrls.length) {
          Toast.fail(`费用明细 ${n}：请上传照片`);
          return false;
        }
      }
    }
    if (forSubmit) {
      const rangeIndex = new Map<string, number[]>();
      lines.forEach((line, i) => {
        if (line.type !== 'trip') return;
        if (line.startMileage === '' || line.endMileage === '') return;
        const startM = Number(line.startMileage);
        const endM = Number(line.endMileage);
        if (!Number.isFinite(startM) || !Number.isFinite(endM)) return;
        const key = `${startM.toFixed(1)}->${endM.toFixed(1)}`;
        const list = rangeIndex.get(key) || [];
        list.push(i + 1);
        rangeIndex.set(key, list);
      });
      for (const [key, idxs] of rangeIndex) {
        if (idxs.length < 2) continue;
        const [start, end] = key.split('->');
        Toast.fail(
          `行程明细 ${idxs.join('、')} 起止里程完全相同（${start} → ${end}），请核对是否重复填写`,
        );
        return false;
      }
    }
    return true;
  };

  const save = async (submit: boolean) => {
    if (!validateDraft(submit)) return;
    const autoFinish = search.get('autoFinish') === '1';
    setBusy(true);
    try {
      const saved = await saveMyTripExpense(id, {
        lineItems: toPayloadLines(lines),
        submit,
        ...(unitId ? { workUnitId: unitId } : {}),
      });
      applyClaim(saved);
      if (autoFinish && submit) {
        try {
          const planned = Math.max(1, Number(item?.plannedUnits) || 1);
          const unitFlow = isMulti || planned > 1;
          if (unitId) {
            await completeFinanceUnit(id, unitId, { skipErrorToast: true });
          } else if (!unitFlow) {
            await finishFinanceCase(id, { skipErrorToast: true });
          }
          Toast.success(submit ? '费用已提交，本单已自动完工' : '已保存');
          return;
        } catch {
          /* 仅保存费用 */
        }
      }
      Toast.success(submit ? '已提交费用审核' : '费用明细已保存');
    } catch {
      /* */
    } finally {
      setBusy(false);
    }
  };

  const thumb = (url: string, onClear?: () => void, previewUrls?: string[], index = 0) => (
    <div className="trip-thumb" key={`${url}-${index}`}>
      <button
        type="button"
        className="trip-thumb-img"
        onClick={() => setViewer({ urls: previewUrls?.length ? previewUrls : [url], index })}
      >
        <img src={displayPhotoUrl(url)} alt="" />
      </button>
      {!readonly && onClear && (
        <button type="button" className="trip-thumb-del" onClick={onClear}>
          ×
        </button>
      )}
    </div>
  );

  const uploadAdd = (target: string, multi = false) => (
    <button
      type="button"
      className="trip-upload-add"
      disabled={readonly || uploading}
      aria-label="添加照片"
      onClick={() => openPick(target, multi)}
    >
      {uploading && pickTarget === target ? '…' : '+'}
    </button>
  );

  const mileageDiff = (line: DraftLine) => {
    const s = Number(line.startMileage);
    const e = Number(line.endMileage);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
    return Math.round((e - s) * 10) / 10;
  };

  if (loading) {
    return (
      <div className="mobile-finance-page">
        <Loading vertical>加载中...</Loading>
      </div>
    );
  }

  if (loadError || !item) {
    return (
      <div className="mobile-finance-page">
        <header className="mobile-finance-head">
          <button type="button" onClick={() => navigate(`/m/finance-cases/${id}`)}>
            ← 返回
          </button>
          <h1>费用明细</h1>
        </header>
        <section className="mobile-finance-card">
          <p className="trip-reject" style={{ marginTop: 0 }}>
            {loadError || '案例不存在'}
          </p>
          <button
            type="button"
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => setRetryTick((n) => n + 1)}
          >
            重试
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head">
        <button type="button" onClick={() => navigate(`/m/finance-cases/${id}`)}>
          ← 返回
        </button>
        <h1>费用明细</h1>
      </header>

      <section className="mobile-finance-card">
        <div className="mobile-finance-row">
          <h2>{item.projectName || item.gspCaseNo}</h2>
          <span className="mobile-finance-status">{STATUS_LABEL[status] || status}</span>
        </div>
        <div className="trip-remind-banner" style={{ marginTop: 10 }}>
          <strong>按需填写</strong>
          <p>
            可添加多条费用明细。行程需填里程与导航；过路费等上传凭证即可。不报销直接返回。
          </p>
        </div>
        {status === 'approved' && approvedAmount != null && (
          <p className="trip-diff" style={{ marginTop: 10 }}>
            申报 ¥{Number(claimAmount || totalAmount || 0).toFixed(2)} · 核定报销{' '}
            <strong>¥{Number(approvedAmount).toFixed(2)}</strong>
          </p>
        )}
        {reviewNote && status === 'rejected' && (
          <p className="trip-reject">驳回原因：{reviewNote}</p>
        )}
        {isMulti && unitId ? (
          <p className="trip-unit-tag">
            关联{unitLabel} · 可选
          </p>
        ) : null}
      </section>

      {lines.map((line, index) => {
        const diff = mileageDiff(line);
        return (
          <section className="exp-line-card" key={line.id}>
            <div className="exp-line-head">
              <h3>费用明细 {index + 1}</h3>
              {!readonly && (
                <div className="exp-line-actions">
                  <button type="button" onClick={() => copyLine(line.id)}>
                    复制
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    disabled={lines.length <= 1}
                    onClick={() => removeLine(line.id)}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>

            <label className="trip-field">
              <span>类型 *</span>
              <select
                value={line.type}
                disabled={readonly}
                onChange={(e) => setLineType(line.id, e.target.value as LineType)}
              >
                <option value="trip">行程</option>
                <option value="toll">过路费</option>
                <option value="other">其他</option>
              </select>
            </label>

            <label className="trip-field">
              <span>内容 *</span>
              <input
                value={line.content}
                disabled={readonly || line.type !== 'other'}
                placeholder={line.type === 'other' ? '请填写内容' : undefined}
                onChange={(e) => updateLine(line.id, { content: e.target.value })}
              />
            </label>

            {line.type === 'trip' ? (
              <>
                <h4 className="exp-line-sub">开始里程表</h4>
                <div className="trip-upload-row">
                  {line.startOdometerUrl
                    ? thumb(line.startOdometerUrl, () =>
                        updateLine(line.id, { startOdometerUrl: '', startMileage: '' }),
                      )
                    : uploadAdd(`startOdo:${line.id}`)}
                </div>
                <label className="trip-field">
                  <span>开始里程（km）</span>
                  <input
                    inputMode="decimal"
                    value={line.startMileage}
                    disabled={readonly}
                    placeholder="识别后可改"
                    onChange={(e) => updateLine(line.id, { startMileage: e.target.value })}
                  />
                </label>
                {line.startOdometerUrl && !readonly && (
                  <button
                    type="button"
                    className="trip-ocr-link"
                    disabled={ocrBusy}
                    onClick={() => void runOcr(line.id, line.startOdometerUrl, 'start')}
                  >
                    {ocrBusy ? '识别中…' : '重新识别里程'}
                  </button>
                )}

                <h4 className="exp-line-sub">开始导航截图</h4>
                <p className="exp-line-hint">可多张；每张填一条备注</p>
                {line.startNavShots.map((shot, idx) => (
                  <div className="exp-nav-shot" key={`${shot.url}-${idx}`}>
                    <div className="trip-upload-row">
                      {thumb(
                        shot.url,
                        () =>
                          updateLine(line.id, {
                            startNavShots: line.startNavShots.filter((_, i) => i !== idx),
                          }),
                        line.startNavShots.map((s) => s.url),
                        idx,
                      )}
                    </div>
                    <label className="trip-field">
                      <span>备注（图 {idx + 1}）</span>
                      <input
                        value={shot.remark || ''}
                        disabled={readonly}
                        placeholder="工程师自填"
                        onChange={(e) => {
                          const next = line.startNavShots.map((s, i) =>
                            i === idx ? { ...s, remark: e.target.value } : s,
                          );
                          updateLine(line.id, { startNavShots: next });
                        }}
                      />
                    </label>
                  </div>
                ))}
                {!readonly && line.startNavShots.length < 12 && (
                  <div className="trip-upload-row">
                    {uploadAdd(`startNav:${line.id}`, true)}
                  </div>
                )}

                <h4 className="exp-line-sub">结束导航截图</h4>
                <p className="exp-line-hint">可多张；每张填一条备注</p>
                {line.endNavShots.map((shot, idx) => (
                  <div className="exp-nav-shot" key={`${shot.url}-${idx}`}>
                    <div className="trip-upload-row">
                      {thumb(
                        shot.url,
                        () =>
                          updateLine(line.id, {
                            endNavShots: line.endNavShots.filter((_, i) => i !== idx),
                          }),
                        line.endNavShots.map((s) => s.url),
                        idx,
                      )}
                    </div>
                    <label className="trip-field">
                      <span>备注（图 {idx + 1}）</span>
                      <input
                        value={shot.remark || ''}
                        disabled={readonly}
                        placeholder="工程师自填"
                        onChange={(e) => {
                          const next = line.endNavShots.map((s, i) =>
                            i === idx ? { ...s, remark: e.target.value } : s,
                          );
                          updateLine(line.id, { endNavShots: next });
                        }}
                      />
                    </label>
                  </div>
                ))}
                {!readonly && line.endNavShots.length < 12 && (
                  <div className="trip-upload-row">
                    {uploadAdd(`endNav:${line.id}`, true)}
                  </div>
                )}

                <h4 className="exp-line-sub">结束里程表</h4>
                <div className="trip-upload-row">
                  {line.endOdometerUrl
                    ? thumb(line.endOdometerUrl, () =>
                        updateLine(line.id, { endOdometerUrl: '', endMileage: '' }),
                      )
                    : uploadAdd(`endOdo:${line.id}`)}
                </div>
                <label className="trip-field">
                  <span>结束里程（km）</span>
                  <input
                    inputMode="decimal"
                    value={line.endMileage}
                    disabled={readonly}
                    placeholder="识别后可改"
                    onChange={(e) => updateLine(line.id, { endMileage: e.target.value })}
                  />
                </label>
                {line.endOdometerUrl && !readonly && (
                  <button
                    type="button"
                    className="trip-ocr-link"
                    disabled={ocrBusy}
                    onClick={() => void runOcr(line.id, line.endOdometerUrl, 'end')}
                  >
                    {ocrBusy ? '识别中…' : '重新识别里程'}
                  </button>
                )}
                {diff != null && (
                  <p className="trip-diff">
                    里程差 <strong>{diff}</strong> km（审核参考）
                  </p>
                )}

                <label className="trip-field">
                  <span>日期 *</span>
                  <ExpenseDateField
                    value={line.expenseDate}
                    disabled={readonly}
                    onChange={(next) => updateLine(line.id, { expenseDate: next })}
                  />
                </label>
                <label className="trip-field">
                  <span>金额（元）</span>
                  <input
                    inputMode="decimal"
                    value={line.amount}
                    disabled={readonly}
                    placeholder="没有费用填 0"
                    onChange={(e) => updateLine(line.id, { amount: e.target.value })}
                  />
                </label>
                <h4 className="exp-line-sub">费用凭证（可选）</h4>
                <div className="trip-upload-row">
                  {line.voucherUrls.map((u, idx) =>
                    thumb(
                      u,
                      () =>
                        updateLine(line.id, {
                          voucherUrls: line.voucherUrls.filter((_, i) => i !== idx),
                        }),
                      line.voucherUrls,
                      idx,
                    ),
                  )}
                  {!readonly && line.voucherUrls.length < 20 && uploadAdd(`voucher:${line.id}`, true)}
                </div>
              </>
            ) : (
              <>
                <h4 className="exp-line-sub">照片</h4>
                <div className="trip-upload-row">
                  {line.photoUrls.map((u, idx) =>
                    thumb(
                      u,
                      () =>
                        updateLine(line.id, {
                          photoUrls: line.photoUrls.filter((_, i) => i !== idx),
                        }),
                      line.photoUrls,
                      idx,
                    ),
                  )}
                  {!readonly && line.photoUrls.length < 20 && uploadAdd(`photo:${line.id}`, true)}
                </div>
                <label className="trip-field">
                  <span>日期 *</span>
                  <ExpenseDateField
                    value={line.expenseDate}
                    disabled={readonly}
                    onChange={(next) => updateLine(line.id, { expenseDate: next })}
                  />
                </label>
                <label className="trip-field">
                  <span>金额（元）*</span>
                  <input
                    inputMode="decimal"
                    value={line.amount}
                    disabled={readonly}
                    placeholder="请输入"
                    onChange={(e) => updateLine(line.id, { amount: e.target.value })}
                  />
                </label>
              </>
            )}

            <label className="trip-field">
              <span>备注（可选）</span>
              <textarea
                rows={2}
                value={line.note}
                disabled={readonly}
                placeholder="可选"
                onChange={(e) => updateLine(line.id, { note: e.target.value })}
              />
            </label>
          </section>
        );
      })}

      {!readonly && (
        <section className="mobile-finance-card exp-add-card">
          <button type="button" className="exp-add-btn" onClick={() => addLine('toll')}>
            + 添加明细
          </button>
          <p className="exp-line-hint" style={{ marginTop: 8 }}>
            合计申报 ¥{totalAmount.toFixed(2)}
          </p>
          <button
            type="button"
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={() => void save(false)}
          >
            保存草稿
          </button>
          <button
            type="button"
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 10 }}
            disabled={busy}
            onClick={() => void save(true)}
          >
            提交费用审核
          </button>
        </section>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />

      <ActionSheet
        visible={pickSheetOpen}
        onCancel={() => {
          setPickSheetOpen(false);
          setPickTarget(null);
        }}
        cancelText="取消"
        actions={[
          { name: '拍照' },
          {
            name: pickMulti ? '从相册选择（可多选）' : '从相册选择',
          },
        ]}
        onSelect={(action) => {
          setPickSheetOpen(false);
          runFilePick(action.name === '拍照' ? 'camera' : 'gallery');
        }}
      />

      {viewer && (
        <PhotoViewerOverlay
          urls={viewer.urls.map(displayPhotoUrl)}
          initialIndex={viewer.index}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
