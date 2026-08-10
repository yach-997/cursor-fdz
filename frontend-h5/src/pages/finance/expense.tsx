import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loading, Toast } from 'react-vant';
import {
  completeFinanceUnit,
  fetchMyFinanceCase,
  finishFinanceCase,
  ocrUnitMileage,
  saveUnitTripExpense,
  uploadFinanceWorkPhoto,
  type MobileFinanceCase,
  type TripExpenseClaim,
} from '../../api/finance';
import { useAuthStore } from '../../stores/auth';
import PhotoViewerOverlay from '../../components/PhotoViewerOverlay';
import { displayPhotoUrl } from '../../utils/photo-url';
import './finance.css';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  submitted: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

type Step = 'start' | 'end';

export default function FinanceExpensePage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickTarget, setPickTarget] = useState<string | null>(null);
  const [multiPick, setMultiPick] = useState(false);

  const [item, setItem] = useState<MobileFinanceCase>();
  const [unitId, setUnitId] = useState(search.get('unitId') || '');
  const [step, setStep] = useState<Step>(
    search.get('step') === 'end' ? 'end' : 'start',
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null);

  const [tripSkipped, setTripSkipped] = useState(false);
  /** 开始页：先选有行程/无行程；fix=1 或点「改为填写」时进入表单 */
  const [showStartForm, setShowStartForm] = useState(search.get('fix') === '1');

  const [startOdometerUrl, setStartOdometerUrl] = useState('');
  const [startNavUrl, setStartNavUrl] = useState('');
  const [startMileage, setStartMileage] = useState('');
  const [endOdometerUrl, setEndOdometerUrl] = useState('');
  const [endNavUrl, setEndNavUrl] = useState('');
  const [endMileage, setEndMileage] = useState('');
  const [amount, setAmount] = useState('');
  const [voucherUrls, setVoucherUrls] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('draft');
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [claimAmount, setClaimAmount] = useState<string | null>(null);
  const [approvedAmount, setApprovedAmount] = useState<string | null>(null);

  const unitLabel = item?.unitLabel || '台';
  const isMulti = item?.assignMode === 'multi';
  const afterInspect = search.get('after') === 'inspect';
  const forceFix = search.get('fix') === '1';

  const myUnits = useMemo(() => {
    const units = item?.units || [];
    if (!userId) return units;
    const mine = units.filter(
      (u) =>
        u.inspectorId === userId &&
        ['claimed', 'submitted', 'completed'].includes(u.status),
    );
    if (mine.length) return mine;
    return !isMulti && units[0] ? [units[0]] : mine;
  }, [item?.units, userId, isMulti]);

  const applyClaim = (claim?: TripExpenseClaim | null) => {
    if (!claim) {
      setTripSkipped(false);
      if (!forceFix) setShowStartForm(false);
      return;
    }
    setTripSkipped(!!claim.tripSkipped);
    setStartOdometerUrl(claim.startOdometerUrl || '');
    setStartNavUrl(claim.startNavUrl || '');
    setStartMileage(claim.startMileage != null ? String(claim.startMileage) : '');
    setEndOdometerUrl(claim.endOdometerUrl || '');
    setEndNavUrl(claim.endNavUrl || '');
    setEndMileage(claim.endMileage != null ? String(claim.endMileage) : '');
    const declared = claim.claimAmount ?? claim.amount;
    setAmount(declared != null && Number(declared) ? String(Number(declared)) : '');
    setVoucherUrls(claim.voucherUrls || []);
    setNote(claim.note || '');
    setStatus(claim.status || 'draft');
    setReviewNote(claim.reviewNote || null);
    setClaimAmount(claim.claimAmount ?? null);
    setApprovedAmount(claim.status === 'approved' ? claim.amount : null);
    const hasStart = !!(
      claim.startOdometerUrl &&
      claim.startNavUrl &&
      claim.startMileage != null &&
      claim.startMileage !== ''
    );
    if (forceFix || hasStart) setShowStartForm(true);
    else if (claim.tripSkipped) setShowStartForm(false);
  };

  useEffect(() => {
    void fetchMyFinanceCase(id).then((data) => {
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
      if (search.get('step') === 'end') setStep('end');
      applyClaim((data.expenses || []).find((e) => e.workUnitId === nextUnit));
    });
  }, [id, search, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!item || !unitId) return;
    const claim = (item.expenses || []).find((e) => e.workUnitId === unitId);
    if (claim) applyClaim(claim);
    else {
      setTripSkipped(false);
      setStartOdometerUrl('');
      setStartNavUrl('');
      setStartMileage('');
      setEndOdometerUrl('');
      setEndNavUrl('');
      setEndMileage('');
      setAmount('');
      setVoucherUrls([]);
      setNote('');
      setStatus('draft');
      setReviewNote(null);
      setClaimAmount(null);
      setApprovedAmount(null);
      setShowStartForm(forceFix);
    }
  }, [unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  const readonly = status === 'submitted' || status === 'approved';
  const currentUnit =
    myUnits.find((u) => u.id === unitId) || item?.units?.find((u) => u.id === unitId);
  const mileageDiff = useMemo(() => {
    const s = Number(startMileage);
    const e = Number(endMileage);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
    return Math.round((e - s) * 10) / 10;
  }, [startMileage, endMileage]);

  if (!item) {
    return (
      <div className="mobile-finance-page">
        <Loading vertical>加载中...</Loading>
      </div>
    );
  }

  const goAfterStart = () => {
    if (afterInspect) {
      const taskId =
        currentUnit?.inspectionTaskId ||
        item.activeUnit?.inspectionTaskId ||
        item.inspectionTaskId;
      if (taskId) {
        navigate(`/m/inspection/${taskId}`, { replace: true });
        return;
      }
    }
    navigate(`/m/finance-cases/${id}`, { replace: true });
  };

  const openPick = (target: string, multi = false) => {
    if (readonly) return;
    setPickTarget(target);
    setMultiPick(multi);
    fileRef.current?.click();
  };

  const onPick = async (files: FileList | null) => {
    if (!files?.length || !pickTarget || readonly) return;
    setUploading(true);
    try {
      const list = multiPick ? Array.from(files).slice(0, 12) : [files[0]];
      for (const file of list) {
        const res = await uploadFinanceWorkPhoto(id, file);
        const url = res?.url;
        if (!url) continue;
        if (pickTarget === 'startOdo') {
          setStartOdometerUrl(url);
          await runOcr(url, 'start');
        } else if (pickTarget === 'startNav') setStartNavUrl(url);
        else if (pickTarget === 'endOdo') {
          setEndOdometerUrl(url);
          await runOcr(url, 'end');
        } else if (pickTarget === 'endNav') setEndNavUrl(url);
        else if (pickTarget === 'voucher') {
          setVoucherUrls((p) => [...p, url].slice(0, 20));
        }
      }
      Toast.success('已上传');
    } catch {
      /* */
    } finally {
      setUploading(false);
      setPickTarget(null);
      setMultiPick(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runOcr = async (imageUrl: string, kind: 'start' | 'end') => {
    if (!unitId) return;
    setOcrBusy(true);
    try {
      const res = await ocrUnitMileage(id, unitId, imageUrl, kind);
      if (res.mileage != null) {
        if (kind === 'start') setStartMileage(String(res.mileage));
        else setEndMileage(String(res.mileage));
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

  const payload = (extra?: { tripSkipped?: boolean }) => ({
    startOdometerUrl: startOdometerUrl || null,
    startNavUrl: startNavUrl || null,
    startMileage: startMileage === '' ? null : Number(startMileage),
    endOdometerUrl: endOdometerUrl || null,
    endNavUrl: endNavUrl || null,
    endMileage: endMileage === '' ? null : Number(endMileage),
    amount: Number(amount) || 0,
    voucherUrls,
    note,
    ...extra,
  });

  const saveSkip = async () => {
    if (!unitId) return Toast.fail(`请先选择${unitLabel}`);
    setBusy(true);
    try {
      const saved = await saveUnitTripExpense(id, unitId, {
        tripSkipped: true,
        amount: 0,
        voucherUrls: [],
      });
      setStatus(saved.status);
      setTripSkipped(true);
      setShowStartForm(false);
      Toast.success('已标记无行程，可直接开工');
      goAfterStart();
    } catch {
      /* */
    } finally {
      setBusy(false);
    }
  };

  const saveStart = async () => {
    if (!unitId) return Toast.fail(`请先选择${unitLabel}`);
    if (!startOdometerUrl || !startNavUrl) {
      return Toast.fail('请上传开始里程表和导航截图');
    }
    if (startMileage === '' || !Number.isFinite(Number(startMileage))) {
      return Toast.fail('请填写开始里程');
    }
    setBusy(true);
    try {
      const saved = await saveUnitTripExpense(id, unitId, {
        ...payload({ tripSkipped: false }),
      });
      setStatus(saved.status);
      setTripSkipped(false);
      Toast.success('开始行程已保存，可以开工');
      goAfterStart();
    } catch {
      /* */
    } finally {
      setBusy(false);
    }
  };

  const saveEnd = async (submitFee: boolean) => {
    if (!unitId) return Toast.fail(`请先选择${unitLabel}`);
    if (!endOdometerUrl || !endNavUrl) {
      return Toast.fail('请上传结束里程表和导航截图');
    }
    if (endMileage === '' || !Number.isFinite(Number(endMileage))) {
      return Toast.fail('请填写结束里程');
    }
    if (submitFee && Number(amount) > 0 && !voucherUrls.length) {
      return Toast.fail('有报销金额时请上传费用凭证');
    }
    const autoFinish = search.get('autoFinish') === '1';
    setBusy(true);
    try {
      const saved = await saveUnitTripExpense(id, unitId, {
        ...payload({ tripSkipped: false }),
        submit: submitFee && Number(amount) > 0,
      });
      setStatus(saved.status);

      if (autoFinish || item.status === 'working') {
        try {
          if (isMulti && unitId) {
            await completeFinanceUnit(id, unitId, { skipErrorToast: true });
          } else {
            await finishFinanceCase(id, { skipErrorToast: true });
          }
          Toast.success(
            submitFee && Number(amount) > 0 ? '费用已提交，本单已自动完工' : '本单已自动完工',
          );
          navigate('/m/tasks', { replace: true });
          return;
        } catch {
          /* 报告未提交等情况：仅保存行程 */
        }
      }

      Toast.success(
        submitFee && Number(amount) > 0 ? '已提交费用审核' : '结束行程与费用已保存',
      );
      navigate(`/m/finance-cases/${id}`, { replace: true });
    } catch {
      /* */
    } finally {
      setBusy(false);
    }
  };

  const thumb = (url: string, onClear?: () => void) => (
    <div className="trip-thumb" key={url}>
      <button
        type="button"
        className="trip-thumb-img"
        onClick={() => setViewer({ urls: [url], index: 0 })}
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

  const needChoice = step === 'start' && !showStartForm && !readonly;

  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head">
        <button type="button" onClick={() => navigate(`/m/finance-cases/${id}`)}>
          ← 返回
        </button>
        <h1>行程补填 / 查看</h1>
      </header>

      <section className="mobile-finance-card">
        <div className="mobile-finance-row">
          <h2>{item.projectName || item.gspCaseNo}</h2>
          <span className="mobile-finance-status">{STATUS_LABEL[status] || status}</span>
        </div>
        <div className="trip-remind-banner" style={{ marginTop: 10 }}>
          <strong>异常补填入口</strong>
          <p>
            正常请在作业产品线步骤里完成开始/结束行程。本页仅用于卡住补填或查看审核结果。
          </p>
        </div>
        {tripSkipped && !showStartForm && (
          <p className="trip-skip-tag">已标记：无行程（管理员可见）</p>
        )}
        {status === 'approved' && approvedAmount != null && (
          <p className="trip-diff" style={{ marginTop: 10 }}>
            申报 ¥{Number(claimAmount || amount || 0).toFixed(2)} · 核定报销{' '}
            <strong>¥{Number(approvedAmount).toFixed(2)}</strong>
          </p>
        )}
        {reviewNote && status === 'rejected' && (
          <p className="trip-reject">驳回原因：{reviewNote}</p>
        )}
        {myUnits.length > 1 && (
          <label className="trip-field" style={{ marginTop: 12 }}>
            <span>选择{unitLabel}</span>
            <select
              value={unitId}
              disabled={readonly}
              onChange={(e) => setUnitId(e.target.value)}
            >
              {myUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitLabel} #{u.seq}
                </option>
              ))}
            </select>
          </label>
        )}
        {currentUnit && myUnits.length <= 1 && (
          <p className="trip-unit-tag">
            {unitLabel} #{currentUnit.seq}
          </p>
        )}
      </section>

      {!needChoice && (
        <div className="trip-steps">
          <button
            type="button"
            className={step === 'start' ? 'is-active' : ''}
            onClick={() => setStep('start')}
          >
            1. 开始
          </button>
          <button
            type="button"
            className={step === 'end' ? 'is-active' : ''}
            onClick={() => {
              if (tripSkipped && !showStartForm) {
                Toast.info('无行程无需填写结束里程');
                return;
              }
              setStep('end');
            }}
          >
            2. 结束与费用
          </button>
        </div>
      )}

      {needChoice && (
        <section className="mobile-finance-card">
          <h3>补选行程</h3>
          <div className="trip-choice-grid">
            <button
              type="button"
              className="trip-choice-btn is-primary"
              disabled={busy}
              onClick={() => {
                setShowStartForm(true);
                setTripSkipped(false);
              }}
            >
              <strong>有行程</strong>
              <span>补填开始里程</span>
            </button>
            <button
              type="button"
              className="trip-choice-btn"
              disabled={busy}
              onClick={() => void saveSkip()}
            >
              <strong>无行程</strong>
              <span>标记后返回</span>
            </button>
          </div>
        </section>
      )}

      {step === 'start' && showStartForm && (
        <section className="mobile-finance-card">
          <h3>开始里程表</h3>
          <div className="trip-upload-row">
            {startOdometerUrl ? (
              thumb(startOdometerUrl, () => {
                setStartOdometerUrl('');
                setStartMileage('');
              })
            ) : (
              <button
                type="button"
                className="trip-upload-btn"
                disabled={readonly || uploading}
                onClick={() => openPick('startOdo')}
              >
                拍照/上传里程表
              </button>
            )}
            {startOdometerUrl && !readonly && (
              <button
                type="button"
                className="mobile-finance-secondary"
                disabled={ocrBusy}
                onClick={() => void runOcr(startOdometerUrl, 'start')}
              >
                {ocrBusy ? '识别中…' : '重新识别'}
              </button>
            )}
          </div>
          <label className="trip-field">
            <span>开始里程（km）</span>
            <input
              inputMode="decimal"
              value={startMileage}
              disabled={readonly}
              placeholder="识别后可改"
              onChange={(e) => setStartMileage(e.target.value)}
            />
          </label>
          <h3 style={{ marginTop: 16 }}>导航截图</h3>
          <div className="trip-upload-row">
            {startNavUrl ? (
              thumb(startNavUrl, () => setStartNavUrl(''))
            ) : (
              <button
                type="button"
                className="trip-upload-btn"
                disabled={readonly || uploading}
                onClick={() => openPick('startNav')}
              >
                上传导航截图
              </button>
            )}
          </div>
          {!readonly && (
            <button
              type="button"
              className="mobile-finance-primary"
              style={{ width: '100%', marginTop: 16 }}
              disabled={busy}
              onClick={() => void saveStart()}
            >
              保存开始行程
            </button>
          )}
        </section>
      )}

      {step === 'end' && (
        <section className="mobile-finance-card">
          <div className="trip-remind-banner" style={{ marginBottom: 12 }}>
            <strong>结束里程与费用同屏</strong>
            <p>里程表 + 导航必填；费用自己加总填一个数，凭证可批量上传。</p>
          </div>
          <h3>结束里程表</h3>
          <div className="trip-upload-row">
            {endOdometerUrl ? (
              thumb(endOdometerUrl, () => {
                setEndOdometerUrl('');
                setEndMileage('');
              })
            ) : (
              <button
                type="button"
                className="trip-upload-btn"
                disabled={readonly || uploading}
                onClick={() => openPick('endOdo')}
              >
                拍照/上传里程表
              </button>
            )}
            {endOdometerUrl && !readonly && (
              <button
                type="button"
                className="mobile-finance-secondary"
                disabled={ocrBusy}
                onClick={() => void runOcr(endOdometerUrl, 'end')}
              >
                {ocrBusy ? '识别中…' : '重新识别'}
              </button>
            )}
          </div>
          <label className="trip-field">
            <span>结束里程（km）</span>
            <input
              inputMode="decimal"
              value={endMileage}
              disabled={readonly}
              placeholder="识别后可改"
              onChange={(e) => setEndMileage(e.target.value)}
            />
          </label>
          {mileageDiff != null && (
            <p className="trip-diff">
              里程差 <strong>{mileageDiff}</strong> km（审核参考）
            </p>
          )}
          <h3 style={{ marginTop: 16 }}>导航截图</h3>
          <div className="trip-upload-row">
            {endNavUrl ? (
              thumb(endNavUrl, () => setEndNavUrl(''))
            ) : (
              <button
                type="button"
                className="trip-upload-btn"
                disabled={readonly || uploading}
                onClick={() => openPick('endNav')}
              >
                上传导航截图
              </button>
            )}
          </div>

          <h3 style={{ marginTop: 16 }}>报销费用</h3>
          <label className="trip-field">
            <span>申报金额（元）</span>
            <input
              inputMode="decimal"
              value={amount}
              disabled={readonly}
              placeholder="没有费用填 0"
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <div className="trip-upload-row">
            {voucherUrls.map((u) =>
              thumb(u, () => setVoucherUrls(voucherUrls.filter((x) => x !== u))),
            )}
            {!readonly && voucherUrls.length < 20 && (
              <button
                type="button"
                className="trip-upload-btn"
                disabled={uploading}
                onClick={() => openPick('voucher', true)}
              >
                批量上传凭证
              </button>
            )}
          </div>
          <label className="trip-field">
            <span>备注</span>
            <textarea
              rows={2}
              value={note}
              disabled={readonly}
              placeholder="可选"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {!readonly && (
            <button
              type="button"
              className="mobile-finance-primary"
              style={{ width: '100%', marginTop: 16 }}
              disabled={busy}
              onClick={() => void saveEnd(true)}
            >
              {Number(amount) > 0
                ? '保存结束里程并提交费用'
                : '保存结束里程（无费用）'}
            </button>
          )}
        </section>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture={multiPick ? undefined : 'environment'}
        multiple={multiPick}
        hidden
        onChange={(e) => void onPick(e.target.files)}
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
