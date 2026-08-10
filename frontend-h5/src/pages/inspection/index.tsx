import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import {
  Cell,
  Button,
  Empty,
  Toast,
  Image,
  Dialog,
  Input,
  Tag,
} from 'react-vant';
import { fetchTask, startTask, type TaskItem } from '../../api/task';
import {
  fetchMyFinanceCase,
} from '../../api/finance';
import {
  saveDraft,
  submitRecord,
  uploadPhoto,
  analyzeAi,
  fetchAiResult,
  fetchRecord,
  checkTaskLocation,
  type LocationVerification,
  type RecordEntry,
  type RecordItem,
} from '../../api/record';
import { compressImage } from '../../utils/imageCompress';
import { displayPhotoUrl } from '../../utils/photo-url';
import { chineseErrorMessage } from '../../utils/displayLabels';
import { resolveWorkTypeLabel, workActionLabel } from '../../utils/workTypeLabels';
import PhotoViewerOverlay from '../../components/PhotoViewerOverlay';
import {
  TripChoiceCard,
  TripEndPanel,
  TripStartPanel,
  emptyTripForm,
  isEndTripReady,
  isStartTripReady,
  persistTripEnd,
  persistTripSkip,
  persistTripStart,
  resolveTripMode,
  tripFormFromClaim,
  type TripFormState,
  type TripMode,
} from './trip-steps';
import './inspection.css';

const RESULT_LABEL: Record<string, string> = {
  pass: '合格',
  fail: '不合格',
  pending: '分析中/待确认',
  error: 'AI失败·待人工',
};

/** 故障记录项：必须实时+历史两类截图 */
function isFaultRecordItem(tpl?: { name?: string; description?: string } | null) {
  const text = `${tpl?.name || ''}\n${tpl?.description || ''}`;
  return /上传故障|故障记录|实时故障|历史故障/.test(text);
}

/** 安装固定：至少两张不同角度 */
function isMountFixItem(tpl?: { name?: string; description?: string } | null) {
  const text = `${tpl?.name || ''}\n${tpl?.description || ''}`;
  return /安装固定|支架|墙挂固定/.test(text);
}

function minPhotosRequired(tpl?: { name?: string; description?: string } | null) {
  if (isFaultRecordItem(tpl) || isMountFixItem(tpl)) return 2;
  return 1;
}

interface LiveLocationProof {
  gps: string;
  accuracy: string;
  capturedAt: string;
}

function getLiveLocation(onAccuracy?: (accuracy: number) => void): Promise<LiveLocationProof> {
  if (!('geolocation' in navigator)) {
    return Promise.reject(new Error('当前设备不支持定位'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let best: GeolocationPosition | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      navigator.geolocation.clearWatch(watchId);
      if (error) {
        reject(error);
        return;
      }
      if (!best) {
        reject(new Error('没有获取到有效定位，请检查手机定位服务'));
        return;
      }
      const accuracy = Math.max(1, Math.round(best.coords.accuracy));
      // 精度较差也返回坐标，由后端/报告标记为弱定位，不阻断作业
      resolve({
        gps: `${best.coords.latitude.toFixed(6)},${best.coords.longitude.toFixed(6)}`,
        accuracy: String(accuracy),
        capturedAt: new Date().toISOString(),
      });
    };
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        const accuracy = Math.max(1, Math.round(position.coords.accuracy));
        onAccuracy?.(accuracy);
        // 已达到可靠精度就立即结束；否则继续等待 GPS 收敛。
        if (accuracy <= 80) finish();
      },
      (error) => {
        if (error.code !== error.PERMISSION_DENIED && best) {
          finish();
          return;
        }
        const message =
          error.code === error.PERMISSION_DENIED
            ? '定位权限未开启，请在浏览器设置中允许定位'
            : '现场定位失败（可能无信号），仍可继续拍照上传';
        finish(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
    const timer = window.setTimeout(() => finish(), 15_000);
  });
}

function requestErrorMessage(error: unknown, fallback: string) {
  const candidate = error as {
    message?: string;
    response?: { data?: { message?: string } };
  };
  return chineseErrorMessage(
    candidate?.response?.data?.message || candidate?.message,
    fallback,
  );
}

function PhotoThumbnail({
  url,
  onClick,
  onRemove,
}: {
  url: string;
  onClick: () => void;
  onRemove: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const source = displayPhotoUrl(url);
  const retrySource = attempt
    ? `${source}${source.includes('?') ? '&' : '?'}_retry=${attempt}`
    : source;

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [url]);

  return (
    <div className="inspection-photo-thumb">
      <button type="button" className="inspection-photo-open" onClick={onClick}>
        <img
          src={retrySource}
          alt="巡检现场照片"
          onLoad={() => setFailed(false)}
          onError={() => {
            if (attempt < 2) {
              window.setTimeout(() => setAttempt((value) => value + 1), 800);
            } else {
              setFailed(true);
            }
          }}
        />
        {failed && (
          <span className="inspection-photo-retry" onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}>
            图片加载失败<br />点此重试
          </span>
        )}
      </button>
      <button
        type="button"
        className="inspection-photo-remove"
        aria-label="删除照片"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    </div>
  );
}

/** 巡检执行：要求提示 + 样本图 + 拍照/相册 + 异步AI + 必填校验提交 */
export default function InspectionPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const [task, setTask] = useState<TaskItem | null>(null);
  const [record, setRecord] = useState<RecordItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [wizardIndex, setWizardIndex] = useState(0);
  const [tripMode, setTripMode] = useState<TripMode>('na');
  /** 费用单行程门禁未判定完前，不渲染产品线，避免先闪检查项再出有/无选择 */
  const [tripGateReady, setTripGateReady] = useState(false);
  const [tripForm, setTripForm] = useState<TripFormState>(emptyTripForm);
  const [tripBusy, setTripBusy] = useState(false);
  /** 单人模式旧任务可能缺 workUnitId，从案例台回填 */
  const [tripUnitId, setTripUnitId] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSource, setUploadSource] = useState<'camera' | 'gallery' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadNotice, setUploadNotice] = useState('');
  const [pendingPreview, setPendingPreview] = useState('');
  const [photoPreview, setPhotoPreview] = useState<{
    urls: string[];
    index: number;
  } | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'checking' | 'ok' | 'weak' | 'failed' | 'skipped'
  >('checking');
  const [locationResult, setLocationResult] = useState<LocationVerification | null>(
    null,
  );
  const [locationError, setLocationError] = useState('正在获取现场定位…');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const stepStripRef = useRef<HTMLDivElement>(null);
  const activeStepRef = useRef<HTMLButtonElement>(null);
  const pendingPreviewRef = useRef('');
  const lastFilesRef = useRef<File[]>([]);
  const locationProofRef = useRef<LiveLocationProof | null>(null);
  const locationMetaRef = useRef<{
    locationStatus?: 'ok' | 'weak' | 'failed' | 'skipped';
    locationReasonCode?: string;
    locationReason?: string;
  }>({});
  const pollRefs = useRef<Record<string, number>>({});
  const activeEntryRef = useRef<string | undefined>(undefined);
  const rejectJumpedRef = useRef(false);
  /** 正在 AI 分析的条目，不阻塞其他条目 */
  const [analyzingIds, setAnalyzingIds] = useState<string[]>([]);

  const verifyLocation = useCallback(async () => {
    if (!taskId) throw new Error('缺少作业任务');
    setLocationStatus('checking');
    setLocationError('正在获取高精度现场定位…');
    try {
      const proof = await getLiveLocation((accuracy) => {
        setLocationError(
          accuracy <= 200
            ? `GPS 已连接，当前精度约 ${accuracy} 米…`
            : `正在提高定位精度，当前约 ${accuracy} 米…`,
        );
      });
      const result = await checkTaskLocation({ taskId, ...proof });
      locationProofRef.current = proof;
      const status =
        result.status === 'weak' || result.status === 'ok'
          ? result.status
          : result.verified
            ? 'ok'
            : Number(proof.accuracy) > 200
              ? 'weak'
              : 'ok';
      locationMetaRef.current = {
        locationStatus: status,
        locationReasonCode: result.reasonCode,
        locationReason: result.reason,
      };
      setLocationResult(result);
      setLocationStatus(status);
      setLocationError(result.reason || '');
      return proof;
    } catch (error) {
      const message = requestErrorMessage(error, '现场定位失败');
      locationProofRef.current = null;
      locationMetaRef.current = {
        locationStatus: 'failed',
        locationReasonCode: 'no_signal',
        locationReason: message,
      };
      setLocationResult(null);
      setLocationStatus('failed');
      setLocationError(message);
      return null;
    }
  }, [taskId]);

  const markLocationSkipped = useCallback(() => {
    locationProofRef.current = null;
    locationMetaRef.current = {
      locationStatus: 'skipped',
      locationReasonCode: 'manual_skip',
      locationReason: '工程师确认无法定位后继续作业',
    };
    setLocationResult(null);
    setLocationStatus('skipped');
    setLocationError('已跳过定位，可继续拍照上传；报告将标记位置异常');
  }, []);

  const allEntriesTpl = useMemo(
    () => task?.templateSnapshot || record?.task?.templateSnapshot || [],
    [task, record],
  );

  /** 可选分项（如中压变压器）：默认关闭，开启后才进入检查流程 */
  const [enabledOptionalIds, setEnabledOptionalIds] = useState<string[]>([]);

  const optionalModules = useMemo(
    () => allEntriesTpl.filter((e) => e.isOptionalModule),
    [allEntriesTpl],
  );

  const entriesTpl = useMemo(
    () =>
      allEntriesTpl.filter(
        (e) => !e.isOptionalModule || enabledOptionalIds.includes(e.id),
      ),
    [allEntriesTpl, enabledOptionalIds],
  );

  type WizardStep =
    | { kind: 'start'; label: string }
    | { kind: 'end'; label: string }
    | { kind: 'entry'; label: string; entryIndex: number; tplId: string };

  const wizardSteps = useMemo((): WizardStep[] => {
    const entrySteps: WizardStep[] = entriesTpl.map((e, i) => ({
      kind: 'entry',
      label: e.name,
      entryIndex: i,
      tplId: e.id,
    }));
    if (tripMode === 'need') {
      return [
        { kind: 'start', label: '开始行程' },
        ...entrySteps,
        { kind: 'end', label: '结束与费用' },
      ];
    }
    return entrySteps;
  }, [entriesTpl, tripMode]);

  const currentWizard = wizardSteps[wizardIndex];
  const currentTpl =
    currentWizard?.kind === 'entry' ? entriesTpl[currentWizard.entryIndex] : undefined;
  const workType = resolveWorkTypeLabel(task);
  const currentEntry = record?.entries.find(
    (e) => e.templateEntryId === currentTpl?.id,
  );
  const showTripChoice = tripGateReady && tripMode === 'undecided';
  const showWorkSteps = tripGateReady && tripMode !== 'undecided';
  const caseId = task?.serviceCaseId || '';
  const unitId = tripUnitId || task?.workUnitId || '';

  const jumpToEntryIndex = useCallback(
    (entryIndex: number) => {
      const wi = wizardSteps.findIndex(
        (s) => s.kind === 'entry' && s.entryIndex === entryIndex,
      );
      if (wi >= 0) setWizardIndex(wi);
    },
    [wizardSteps],
  );

  useEffect(() => {
    if (wizardIndex > 0 && wizardIndex >= wizardSteps.length) {
      setWizardIndex(Math.max(0, wizardSteps.length - 1));
    }
  }, [wizardSteps.length, wizardIndex]);

  useLayoutEffect(() => {
    activeStepRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [wizardIndex, wizardSteps.length, showWorkSteps]);

  useEffect(() => {
    activeEntryRef.current = currentTpl?.id;
    setUploadNotice('');
    setUploadProgress(0);
    lastFilesRef.current = [];
    if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
    pendingPreviewRef.current = '';
    setPendingPreview('');
  }, [currentTpl?.id]);

  useEffect(
    () => () => {
      if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
    },
    [],
  );

  const leavePage = useCallback(
    async (saveFirst: boolean) => {
      Object.values(pollRefs.current).forEach((timer) => window.clearInterval(timer));
      pollRefs.current = {};
      try {
        Toast.clear();
      } catch {
        /* ignore */
      }
      if (saveFirst && record) {
        try {
          await saveDraft(
            record.id,
            record.entries.map((e) => ({
              templateEntryId: e.templateEntryId,
              photos: e.photos,
              manualResult: e.manualResult,
              finalResult: e.finalResult,
              remark: e.remark,
            })),
          );
          localStorage.setItem(`draft:${record.id}`, JSON.stringify(record.entries));
        } catch {
          /* 允许离开 */
        }
      }
      Toast.info('已保存，可在任务列表继续');
      if (task?.serviceCaseId) {
        navigate(`/m/finance-cases/${task.serviceCaseId}`, { replace: true });
      } else {
        navigate('/m/tasks', { replace: true });
      }
    },
    [navigate, record, task?.serviceCaseId],
  );

  const onClickBack = () => {
    // 离开时自动保存进度，任务停留在「进行中」，可再点继续
    void leavePage(true);
  };

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setLoadError('');
    setTripGateReady(false);
    try {
      let t = await fetchTask(taskId);
      if (t.status === 'pending' || t.status === 'rejected') {
        t = await startTask(taskId);
      }
      setTask(t);
      if (t.record?.id) {
        const r = await fetchRecord(t.record.id);
        const cached = localStorage.getItem(`draft:${t.record.id}`);
        if (cached) {
          try {
            const localEntries = JSON.parse(cached) as RecordEntry[];
            r.entries = r.entries.map((e) => {
              const local = localEntries.find((x) => x.templateEntryId === e.templateEntryId);
              if (!local) return e;
              return {
                ...e,
                photos: local.photos?.length ? local.photos : e.photos,
                manualResult: local.manualResult || e.manualResult,
                finalResult: local.finalResult ?? e.finalResult,
                remark: local.remark || e.remark,
              };
            });
          } catch {
            /* ignore */
          }
        }
        const optCached = localStorage.getItem(`optmod:${t.record.id}`);
        if (optCached) {
          try {
            const ids = JSON.parse(optCached) as string[];
            if (Array.isArray(ids)) setEnabledOptionalIds(ids);
          } catch {
            /* ignore */
          }
        }
        setRecord(r);
      }
      if (t.serviceCaseId) {
        try {
          const c = await fetchMyFinanceCase(t.serviceCaseId);
          const me = userId || '';
          // 只认本任务台 / 本人认领台，禁止回落到案例第 0 台或别人的费用单
          const resolvedUnit =
            t.workUnitId ||
            c.myActiveUnits?.find((u) => u.inspectionTaskId === t.id)?.id ||
            c.myActiveUnits?.[0]?.id ||
            c.activeUnit?.id ||
            c.units?.find(
              (u) =>
                u.inspectorId === me &&
                ['claimed', 'submitted', 'completed'].includes(u.status),
            )?.id ||
            '';
          setTripUnitId(resolvedUnit);
          const claim = resolvedUnit
            ? (c.expenses || []).find(
                (e) =>
                  e.workUnitId === resolvedUnit &&
                  (!e.inspectorId || !me || e.inspectorId === me),
              )
            : undefined;
          setTripForm(tripFormFromClaim(claim));
          // 本台本人尚无行程结论 → undecided，弹出有/无行程（与单人一致）
          setTripMode(resolveTripMode(claim));
          // 用案例服务类型覆盖任务上的 inspection 默认文案
          if (c.taskTypeName || c.serviceType) {
            setTask((prev) =>
              prev
                ? {
                    ...prev,
                    taskTypeName: c.taskTypeName || prev.taskTypeName,
                    serviceType: c.serviceType || prev.serviceType,
                  }
                : prev,
            );
          }
        } catch {
          setTripUnitId(t.workUnitId || '');
          setTripMode('undecided');
          setTripForm(emptyTripForm());
        } finally {
          setTripGateReady(true);
        }
      } else {
        setTripMode('na');
        setTripUnitId('');
        setTripForm(emptyTripForm());
        setTripGateReady(true);
      }
    } catch (error) {
      setLoadError(requestErrorMessage(error, '作业加载失败，请检查网络后重试'));
      throw error;
    } finally {
      setLoading(false);
    }
  }, [taskId, userId]);

  useEffect(() => {
    void load().catch(() => undefined);
    return () => {
      Object.values(pollRefs.current).forEach((timer) => window.clearInterval(timer));
      pollRefs.current = {};
    };
  }, [load]);

  useEffect(() => {
    if (!task?.id || !record?.id) return;
    void verifyLocation().catch(() => undefined);
  }, [task?.id, record?.id, verifyLocation]);

  useEffect(() => {
    rejectJumpedRef.current = false;
  }, [taskId]);

  // 驳回后首次进入：跳到第一个需返工项
  useEffect(() => {
    if (rejectJumpedRef.current) return;
    if (!task || !record || !entriesTpl.length) return;
    const ids =
      task.record?.rejectReason?.entryIds || record.rejectReason?.entryIds || [];
    if (!ids.length) return;
    const idx = entriesTpl.findIndex((e) => ids.includes(e.id));
    if (idx >= 0) {
      rejectJumpedRef.current = true;
      jumpToEntryIndex(idx);
    }
  }, [task, record, entriesTpl, jumpToEntryIndex]);

  const patchEntry = (patch: Partial<RecordEntry>) => {
    if (!record || !currentTpl) return;
    setRecord({
      ...record,
      entries: record.entries.map((e) =>
        e.templateEntryId === currentTpl.id ? { ...e, ...patch } : e,
      ),
    });
  };

  const handleSaveDraft = async (silent = false) => {
    if (!record) return;
    setSaving(true);
    try {
      const saved = await saveDraft(
        record.id,
        record.entries.map((e) => ({
          templateEntryId: e.templateEntryId,
          photos: e.photos,
          manualResult: e.manualResult,
          finalResult: e.finalResult,
          remark: e.remark,
        })),
      );
      setRecord(saved);
      if (!silent) Toast.success('进度已保存');
      localStorage.setItem(`draft:${record.id}`, JSON.stringify(saved.entries));
    } finally {
      setSaving(false);
    }
  };

  const startPoll = (recordId: string, templateEntryId: string) => {
    const previous = pollRefs.current[templateEntryId];
    if (previous) window.clearInterval(previous);
    let tries = 0;
    pollRefs.current[templateEntryId] = window.setInterval(async () => {
      tries += 1;
      if (tries > 48) {
        window.clearInterval(pollRefs.current[templateEntryId]);
        delete pollRefs.current[templateEntryId];
        setAnalyzingIds((ids) => ids.filter((id) => id !== templateEntryId));
        // 超时按待人工，不阻塞
        setRecord((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            entries: prev.entries.map((e) =>
              e.templateEntryId === templateEntryId
                ? {
                    ...e,
                    aiResult: {
                      status: 'error',
                      confidence: 0,
                      reason: 'AI 超时，请人工判断',
                    },
                  }
                : e,
            ),
          };
        });
        return;
      }
      try {
        const res = await fetchAiResult(templateEntryId, recordId);
        if (res.aiResult && res.aiResult.status !== 'pending') {
          window.clearInterval(pollRefs.current[templateEntryId]);
          delete pollRefs.current[templateEntryId];
          setAnalyzingIds((ids) => ids.filter((id) => id !== templateEntryId));
          const fresh = await fetchRecord(recordId);
          setRecord(fresh);
          const st = res.aiResult.status;
          // 静默回写，不打断现场操作；结果可在报告页查看
          if (st === 'error') {
            /* 失败也不弹窗打断 */
          }
        }
      } catch {
        /* ignore */
      }
    }, 1500);
  };

  const persistPhotos = async (photos: string[]) => {
    if (!record || !currentTpl) return;
    patchEntry({ photos });
    const nextEntries = (record.entries || []).map((e) =>
      e.templateEntryId === currentTpl.id ? { ...e, photos } : e,
    );
    const saved = await saveDraft(
      record.id,
      nextEntries.map((e) => ({
        templateEntryId: e.templateEntryId,
        photos: e.photos,
        manualResult: e.manualResult,
        finalResult: e.finalResult,
        remark: e.remark,
      })),
    );
    setRecord(saved);
  };

  const handleRemovePhoto = (url: string) => {
    Dialog.confirm({
      title: '删除照片',
      message: '确认删除这张现场照片？',
    })
      .then(async () => {
        const photos = (currentEntry?.photos || []).filter((u) => u !== url);
        try {
          await persistPhotos(photos);
          Toast.success('已删除');
        } catch {
          /* 拦截器 */
        }
      })
      .catch(() => undefined);
  };

  const handleCaptureFiles = async (files: File[], source: 'camera' | 'gallery') => {
    if (!record || !currentTpl || !taskId) return;
    const imageFiles = files.filter(
      (f) => !f.type || f.type.startsWith('image/'),
    );
    if (!imageFiles.length) {
      Toast.info('请选择图片文件');
      return;
    }

    if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
    const previewUrl = URL.createObjectURL(imageFiles[0]);
    pendingPreviewRef.current = previewUrl;
    setPendingPreview(previewUrl);
    lastFilesRef.current = imageFiles;
    setUploadSource(source);
    setUploadProgress(0);
    setUploadNotice(
      imageFiles.length > 1
        ? `正在优化并上传 ${imageFiles.length} 张照片…`
        : '正在优化照片并获取定位…',
    );
    setUploading(true);

    let uploadCompleted = false;
    const capturedRecordId = record.id;
    const capturedEntryId = currentTpl.id;
    const capturedSamplePhotos = currentTpl.samplePhotos || [];
    const uploadedUrls: string[] = [];

    try {
      const currentProof = locationProofRef.current;
      let proof: LiveLocationProof | null =
        currentProof && Date.now() - Date.parse(currentProof.capturedAt) < 120_000
          ? currentProof
          : null;
      if (!proof && locationStatus !== 'failed' && locationStatus !== 'skipped') {
        proof = await verifyLocation();
      }

      for (let i = 0; i < imageFiles.length; i += 1) {
        const file = imageFiles[i];
        if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
        const nextPreview = URL.createObjectURL(file);
        pendingPreviewRef.current = nextPreview;
        setPendingPreview(nextPreview);

        setUploadNotice(
          imageFiles.length > 1
            ? `正在上传第 ${i + 1}/${imageFiles.length} 张…`
            : '正在安全上传照片…',
        );
        const compressed = await compressImage(file);
        const uploaded = await uploadPhoto(
          compressed,
          {
            taskId,
            ...(proof || {}),
            ...(locationMetaRef.current || {}),
            // 相册照片与现场拍照都以本次巡检上传时间登记；现场真实性由实时定位留痕。
            photoTakenAt: new Date().toISOString(),
          },
          (percent) => {
            const overall = Math.round(
              ((i + percent / 100) / imageFiles.length) * 100,
            );
            setUploadProgress(Math.min(99, overall));
            if (percent >= 99 && imageFiles.length === 1) {
              setUploadNotice('照片已传送，云端正在保存原图…');
            }
          },
        );
        uploadedUrls.push(uploaded.url);
        lastFilesRef.current = imageFiles.slice(i + 1);
      }

      const basePhotos = currentEntry?.photos || [];
      const photos = [...basePhotos, ...uploadedUrls];
      uploadCompleted = true;
      setUploadProgress(100);
      patchEntry({ photos });
      if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
      pendingPreviewRef.current = '';
      setPendingPreview('');
      lastFilesRef.current = [];
      const entriesSnapshot = record.entries.map((entry) =>
        entry.templateEntryId === capturedEntryId ? { ...entry, photos } : entry,
      );
      localStorage.setItem(`draft:${capturedRecordId}`, JSON.stringify(entriesSnapshot));
      setUploading(false);
      setUploadNotice(
        uploadedUrls.length > 1
          ? `已上传 ${uploadedUrls.length} 张，可以继续下一步；正在后台保存…`
          : '照片已上传，可以继续下一步；正在后台保存…',
      );

      // 草稿和 AI 在后台继续，不再阻塞现场操作。
      void (async () => {
        try {
          const saved = await saveDraft(
            capturedRecordId,
            entriesSnapshot.map((entry) => ({
              templateEntryId: entry.templateEntryId,
              photos: entry.photos,
              manualResult: entry.manualResult,
              finalResult: entry.finalResult,
              remark: entry.remark,
            })),
          );
          setRecord((latest) => {
            if (!latest) return saved;
            const savedEntry = saved.entries.find(
              (entry) => entry.templateEntryId === capturedEntryId,
            );
            return {
              ...latest,
              entries: latest.entries.map((entry) =>
                entry.templateEntryId === capturedEntryId && savedEntry
                  ? { ...entry, photos: savedEntry.photos }
                  : entry,
              ),
            };
          });
          if (activeEntryRef.current === capturedEntryId) {
            setUploadNotice(
              uploadedUrls.length > 1
                ? `已安全保存 ${uploadedUrls.length} 张照片`
                : '照片已安全保存',
            );
          }

          if (task?.aiEnabled !== false && photos.length) {
            setAnalyzingIds((ids) =>
              ids.includes(capturedEntryId) ? ids : [...ids, capturedEntryId],
            );
            try {
              await analyzeAi({
                recordId: capturedRecordId,
                templateEntryId: capturedEntryId,
                photoUrls: photos,
                samplePhotoUrls: capturedSamplePhotos,
              });
              startPoll(capturedRecordId, capturedEntryId);
            } catch {
              setAnalyzingIds((ids) => ids.filter((id) => id !== capturedEntryId));
            }
          }
        } catch {
          if (activeEntryRef.current === capturedEntryId) {
            setUploadNotice('照片已上传并保存在本机，网络恢复后会再次同步');
          }
        }
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败';
      // 已成功的先落本地，剩余可重试
      if (uploadedUrls.length) {
        const photos = [...(currentEntry?.photos || []), ...uploadedUrls];
        patchEntry({ photos });
        const entriesSnapshot = record.entries.map((entry) =>
          entry.templateEntryId === capturedEntryId ? { ...entry, photos } : entry,
        );
        localStorage.setItem(`draft:${capturedRecordId}`, JSON.stringify(entriesSnapshot));
      }
      setUploadNotice(
        message.includes('timeout')
          ? uploadedUrls.length
            ? `已上传 ${uploadedUrls.length} 张，其余超时，请点击重试`
            : '网络响应超时，请点击重试，不会丢失已选照片'
          : uploadedUrls.length
            ? `已上传 ${uploadedUrls.length} 张，其余失败，请点击重试`
            : '上传没有完成，照片仍保留在页面，请检查网络后重试',
      );
    } finally {
      if (!uploadCompleted) setUploading(false);
    }
  };

  const handleCapture = async (file: File, source: 'camera' | 'gallery') => {
    await handleCaptureFiles([file], source);
  };

  /** 仅校验必检项是否已拍照，不要求逐步人工确认 */
  const requiredIncomplete = () => {
    if (!record) return [] as string[];
    const missing: string[] = [];
    for (const tpl of entriesTpl) {
      // 已开启的可选分项视同必检；普通条目看 isRequired
      const must =
        tpl.isOptionalModule || (tpl.isRequired !== false && !tpl.isOptionalModule);
      if (!must) continue;
      const entry = record.entries.find((e) => e.templateEntryId === tpl.id);
      const need = minPhotosRequired(tpl);
      const count = entry?.photos?.length || 0;
      if (count < need) {
        missing.push(
          need > 1
            ? isFaultRecordItem(tpl)
              ? `「${tpl.name}」须上传实时故障与历史故障截图（至少 ${need} 张，当前 ${count} 张）`
              : `「${tpl.name}」须拍摄至少 ${need} 个不同角度（当前 ${count} 张）`
            : `「${tpl.name}」未拍照`,
        );
      }
    }
    return missing;
  };

  const goNext = () => {
    if (uploading || tripBusy) {
      Toast.info('照片正在上传，请稍候');
      return;
    }
    if (currentWizard?.kind === 'start') {
      if (!isStartTripReady(tripForm)) {
        Toast.info('请上传开始里程表、导航截图并填写里程');
        return;
      }
      void (async () => {
        if (!caseId || !unitId) return;
        setTripBusy(true);
        try {
          await persistTripStart(caseId, unitId, tripForm);
          Toast.success('开始行程已保存');
          setWizardIndex((s) => s + 1);
        } catch {
          /* */
        } finally {
          setTripBusy(false);
        }
      })();
      return;
    }
    if (currentWizard?.kind === 'end') {
      // 结束步点「下一步」不存在，应点提交
      return;
    }
    const mustPhoto =
      !!currentTpl &&
      (currentTpl.isOptionalModule || currentTpl.isRequired !== false);
    const need = minPhotosRequired(currentTpl);
    const count = currentEntry?.photos?.length || 0;
    if (mustPhoto && count < need) {
      Toast.info(
        need > 1
          ? isFaultRecordItem(currentTpl)
            ? `本项须同时上传实时故障与历史故障截图（至少 ${need} 张）`
            : `本项须拍摄至少 ${need} 个不同角度照片`
          : '请先上传本项照片',
      );
      return;
    }
    void handleSaveDraft(true);
    setWizardIndex((s) => s + 1);
  };

  const handleSubmit = async () => {
    if (!record) return;
    if (uploading || tripBusy) {
      Toast.info('照片正在上传，请稍候');
      return;
    }
    if (tripMode === 'need') {
      if (!isEndTripReady(tripForm)) {
        Toast.info(
          Number(tripForm.amount) > 0 && !tripForm.voucherUrls.length
            ? '有报销金额时请上传费用凭证'
            : '请补齐结束里程表、导航截图与里程',
        );
        const endIdx = wizardSteps.findIndex((s) => s.kind === 'end');
        if (endIdx >= 0) setWizardIndex(endIdx);
        return;
      }
    }
    if (currentWizard?.kind === 'entry') {
      const mustCurrent =
        !!currentTpl &&
        (currentTpl.isOptionalModule || currentTpl.isRequired !== false);
      const needCurrent = minPhotosRequired(currentTpl);
      const countCurrent = currentEntry?.photos?.length || 0;
      if (mustCurrent && countCurrent < needCurrent) {
        Toast.info(
          needCurrent > 1
            ? isFaultRecordItem(currentTpl)
              ? `本项须同时上传实时故障与历史故障截图（至少 ${needCurrent} 张）`
              : `本项须拍摄至少 ${needCurrent} 个不同角度照片`
            : '请先上传本项照片',
        );
        return;
      }
    }
    const missing = requiredIncomplete();
    if (missing.length) {
      Toast.info(missing[0]);
      const firstName = missing[0].match(/「(.+?)」/)?.[1];
      if (firstName) {
        const idx = entriesTpl.findIndex((e) => e.name === firstName);
        if (idx >= 0) jumpToEntryIndex(idx);
      }
      return;
    }
    try {
      let proof = locationProofRef.current;
      if (
        !proof &&
        locationStatus !== 'failed' &&
        locationStatus !== 'skipped'
      ) {
        proof = await verifyLocation();
      }
      await Dialog.confirm({
        title: '提交报告',
        message:
          locationStatus === 'failed' || locationStatus === 'skipped'
            ? '照片已齐。本次未能完成现场定位，报告将标记「位置异常」，提交后仍可审核。'
            : locationStatus === 'weak'
              ? '照片已齐。本次定位精度较弱，报告将标记「弱定位」。'
              : task?.aiEnabled === false
                ? '照片已齐。提交后将进入管理员人工审核。'
                : '照片已齐。提交后 AI 将在后台继续分析，你可去做其他作业，稍后再看报告结果。',
      });
      setSaving(true);
      if (tripMode === 'need' && caseId && unitId) {
        await persistTripEnd(caseId, unitId, tripForm, true);
      }
      // 先落库再提交，避免本地有图但服务端未同步
      const saved = await saveDraft(
        record.id,
        record.entries.map((e) => ({
          templateEntryId: e.templateEntryId,
          photos: e.photos,
          manualResult: e.manualResult,
          finalResult: e.finalResult,
          remark: e.remark,
        })),
      );
      setRecord(saved);
      const submitted = await submitRecord(saved.id, {
        enabledOptionalModuleIds: enabledOptionalIds,
        ...(proof || {}),
        ...(locationMetaRef.current || {}),
      });
      localStorage.removeItem(`draft:${saved.id}`);
      localStorage.removeItem(`optmod:${saved.id}`);
      navigate('/m/success', {
        state: {
          recordId: submitted.id,
          taskName: task?.taskName,
          serviceCaseId: task?.serviceCaseId || null,
          workUnitId: task?.workUnitId || null,
        },
      });
    } catch {
      /* cancel 或拦截器已提示 */
    } finally {
      setSaving(false);
    }
  };

  const chooseTripNeed = () => {
    setTripMode('need');
    setWizardIndex(0);
  };

  const chooseTripSkip = async () => {
    if (!caseId) {
      setTripMode('skip');
      setWizardIndex(0);
      return;
    }
    if (!unitId) {
      Toast.fail('未找到作业台，请返回后重新进入');
      return;
    }
    setTripBusy(true);
    try {
      await persistTripSkip(caseId, unitId);
      setTripForm(emptyTripForm());
      setTripMode('skip');
      setWizardIndex(0);
      Toast.success('已标记无行程');
    } catch {
      /* */
    } finally {
      setTripBusy(false);
    }
  };

  const switchToNeedFromSkip = () => {
    setTripMode('need');
    setWizardIndex(0);
    Toast.info('请填写开始行程');
  };

  const switchToSkipFromStart = async () => {
    await chooseTripSkip();
  };

  const aiStatus = currentEntry?.aiResult?.status || 'pending';
  const isAnalyzing = currentTpl ? analyzingIds.includes(currentTpl.id) : false;

  return (
    <div className="inspection-page">
      <div
        className="inspection-header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 200,
          background: '#fff',
          borderBottom: '1px solid #e8eeea',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 46,
            padding: '0 8px',
          }}
        >
          <button
            type="button"
            onClick={onClickBack}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#2f9b6a',
              fontSize: 16,
              padding: '8px 12px',
              cursor: 'pointer',
              fontWeight: 600,
              minWidth: 72,
            }}
          >
            ← 返回
          </button>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 16,
              fontWeight: 600,
              color: '#1a2e24',
              marginRight: 72,
            }}
          >
            {workActionLabel(workType, 'executing')}
          </div>
        </div>
      </div>

      {loadError && (!task || !record) ? (
        <div className="inspection-load-state">
          <div className="inspection-load-icon">!</div>
          <h2>{workActionLabel(workType, 'task_noun')}暂时没加载出来</h2>
          <p>{loadError}</p>
          <Button
            round
            type="primary"
            loading={loading}
            onClick={() => void load().catch(() => undefined)}
          >
            重新加载
          </Button>
          <button type="button" className="inspection-load-back" onClick={onClickBack}>
            返回任务列表
          </button>
        </div>
      ) : !task || !record ? (
        <div className="inspection-load-state is-loading">
          <div className="inspection-loading-ring" />
          <h2>正在准备{workActionLabel(workType, 'task_noun')}</h2>
          <p>正在同步检查项和已上传照片…</p>
        </div>
      ) : (
        <div className="inspection-body">
          <Cell
            className="inspection-task-summary"
            title={task.taskName}
            label={`${
              task.serviceCaseId || String(task.device?.serialNumber || '').startsWith('CASE-')
                ? `案例号：${String(task.device?.serialNumber || '')
                    .replace(/^CASE-/, '')
                    .replace(/-\d+$/, '') || '-'}`
                : `序列号：${task.device?.serialNumber || '-'}`
            } · 现场定位将写入报告`}
          />

          <div
            className={`inspection-location-card is-${locationStatus}`}
            style={{
              marginTop: 12,
              padding: '14px 14px 13px',
              borderRadius: 12,
              border: `1px solid ${
                locationStatus === 'ok'
                  ? '#b8e2cf'
                  : locationStatus === 'weak'
                    ? '#ffe7ba'
                    : locationStatus === 'failed' || locationStatus === 'skipped'
                      ? '#f2c2ba'
                      : '#d9e4df'
              }`,
              background:
                locationStatus === 'ok'
                  ? '#eef9f4'
                  : locationStatus === 'weak'
                    ? '#fffbe6'
                    : locationStatus === 'failed' || locationStatus === 'skipped'
                      ? '#fff5f3'
                      : '#f7faf8',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 18,
                  background:
                    locationStatus === 'ok'
                      ? '#16835f'
                      : locationStatus === 'weak'
                        ? '#d48806'
                        : locationStatus === 'failed' || locationStatus === 'skipped'
                          ? '#d95645'
                          : '#80948a',
                  color: '#fff',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {locationStatus === 'ok'
                  ? '✓'
                  : locationStatus === 'weak'
                    ? '~'
                    : locationStatus === 'failed' || locationStatus === 'skipped'
                      ? '!'
                      : '⌖'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#173d2f' }}>
                  {locationStatus === 'ok'
                    ? '现场定位已获取'
                    : locationStatus === 'weak'
                      ? '弱定位（可继续作业）'
                      : locationStatus === 'skipped'
                        ? '已跳过定位（可继续作业）'
                        : locationStatus === 'failed'
                          ? '定位失败（可继续作业）'
                          : '正在获取现场定位'}
                </div>
                <div style={{ marginTop: 3, color: '#687a72', fontSize: 12 }}>
                  {(locationStatus === 'ok' || locationStatus === 'weak') && locationResult
                    ? `${
                        locationResult.latitude != null && locationResult.longitude != null
                          ? `${Number(locationResult.latitude).toFixed(6)}, ${Number(
                              locationResult.longitude,
                            ).toFixed(6)} · `
                          : ''
                      }精度约 ${locationResult.accuracyMeters} 米${
                        locationResult.distanceToSiteMeters != null ||
                        locationResult.distanceMeters
                          ? ` · 距归属网格约 ${
                              locationResult.distanceToSiteMeters ??
                              locationResult.distanceMeters
                            } 米`
                          : ''
                      }${locationResult.reason ? ` · ${locationResult.reason}` : ''}`
                    : locationError}
                </div>
              </div>
              <button
                type="button"
                disabled={locationStatus === 'checking'}
                onClick={() => void verifyLocation()}
                style={{
                  border: '1px solid #b8d4c7',
                  borderRadius: 16,
                  padding: '6px 10px',
                  background: '#fff',
                  color: '#16835f',
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: locationStatus === 'checking' ? 0.55 : 1,
                }}
              >
                {locationStatus === 'checking' ? '定位中' : '重新定位'}
              </button>
            </div>
            {(locationStatus === 'failed' || locationStatus === 'checking') && (
              <button
                type="button"
                onClick={markLocationSkipped}
                style={{
                  marginTop: 10,
                  width: '100%',
                  border: '1px dashed #d9a39a',
                  borderRadius: 10,
                  padding: '8px 10px',
                  background: '#fff',
                  color: '#a04538',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                无法定位，继续作业
              </button>
            )}
            <div style={{ marginTop: 10, color: '#7b8983', fontSize: 11, lineHeight: 1.5 }}>
              {locationStatus === 'failed' || locationStatus === 'skipped'
                ? '偏远无信号时仍可拍照上传并提交；报告会标记「位置异常」，供审核抽查。'
                : locationStatus === 'weak'
                  ? '定位精度较弱，已写入报告弱定位标记，不影响拍照与提交。'
                  : locationResult
                    ? '定位经纬度将随报告提交留痕，不再校验是否在网格围栏内。'
                    : '正在获取现场 GPS；定位失败也可继续作业。'}
            </div>
          </div>

          {(task.record?.rejectReason || record.rejectReason)?.reason && (
            <div
              style={{
                margin: '12px 0 0',
                padding: 12,
                background: '#fff1f0',
                border: '1px solid #ffa39e',
                borderRadius: 8,
                fontSize: 13,
                color: '#a8071a',
                lineHeight: 1.55,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>管理员驳回 · 请重点返工红标项</div>
              <div>原因：{(task.record?.rejectReason || record.rejectReason)?.reason}</div>
            </div>
          )}

          {!tripGateReady ? (
            <div className="trip-wizard-card">
              <h3>准备作业…</h3>
              <p>正在确认行程选项，请稍候</p>
            </div>
          ) : showTripChoice ? (
            <TripChoiceCard
              busy={tripBusy}
              onNeed={chooseTripNeed}
              onSkip={() => void chooseTripSkip()}
            />
          ) : showWorkSteps ? (
            <>
          {(tripMode === 'skip' || tripMode === 'need') && (
            <div
              className={
                tripMode === 'skip' ? 'trip-wizard-skip-bar' : 'trip-wizard-skip-bar is-need'
              }
            >
              <span>{tripMode === 'skip' ? '本台已选：无行程' : '本台已选：有行程'}</span>
              <button
                type="button"
                disabled={tripBusy}
                onClick={() => {
                  if (tripMode === 'skip') switchToNeedFromSkip();
                  else void switchToSkipFromStart();
                }}
              >
                {tripMode === 'skip' ? '改选有行程' : '改为无行程'}
              </button>
            </div>
          )}

          {optionalModules.length > 0 && (
            <div
              style={{
                margin: '12px 0 0',
                padding: 12,
                background: '#fff',
                borderRadius: 8,
                border: '1px solid #e8eeea',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                可选分项（按现场需要开启）
              </div>
              {optionalModules.map((m) => {
                const on = enabledOptionalIds.includes(m.id);
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderTop: '1px solid #f0f0f0',
                      fontSize: 13,
                    }}
                  >
                    <span>{m.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEnabledOptionalIds((prev) => {
                          const next = on
                            ? prev.filter((id) => id !== m.id)
                            : [...prev, m.id];
                          if (record?.id) {
                            localStorage.setItem(
                              `optmod:${record.id}`,
                              JSON.stringify(next),
                            );
                          }
                          return next;
                        });
                        if (!on) {
                          const idx = allEntriesTpl
                            .filter(
                              (e) =>
                                !e.isOptionalModule ||
                                [...enabledOptionalIds, m.id].includes(e.id),
                            )
                            .findIndex((e) => e.id === m.id);
                          if (idx >= 0) jumpToEntryIndex(idx);
                        }
                      }}
                      style={{
                        border: 'none',
                        borderRadius: 14,
                        padding: '4px 12px',
                        background: on ? '#07c160' : '#f0f2f1',
                        color: on ? '#fff' : '#666',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {on ? '已开启' : '开启'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div
            className="inspection-progress-card"
            style={{
              margin: '12px 0',
              padding: '12px 14px',
              background: '#fff',
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              进度 {wizardSteps.length ? wizardIndex + 1 : 0} / {wizardSteps.length || 0}
              {tripMode === 'need' ? (
                <span style={{ marginLeft: 8, fontWeight: 500, color: '#087b59', fontSize: 12 }}>
                  含第1步开始行程、最后一步结束与费用
                </span>
              ) : null}
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: '#e8eeea',
                overflow: 'hidden',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${
                    wizardSteps.length
                      ? ((wizardIndex + 1) / wizardSteps.length) * 100
                      : 0
                  }%`,
                  background: '#07c160',
                }}
              />
            </div>
            <div className="inspection-step-strip" ref={stepStripRef}>
              {wizardSteps.map((ws, idx) => {
                let done = false;
                let needRedo = false;
                let pendingAi = false;
                const isTrip = ws.kind === 'start' || ws.kind === 'end';
                if (ws.kind === 'start') {
                  done = isStartTripReady(tripForm);
                } else if (ws.kind === 'end') {
                  done = isEndTripReady(tripForm);
                } else {
                  const entry = record.entries.find((x) => x.templateEntryId === ws.tplId);
                  done = !!entry?.photos?.length;
                  pendingAi = analyzingIds.includes(ws.tplId);
                  const rejectIds =
                    (task.record?.rejectReason || record.rejectReason)?.entryIds || [];
                  needRedo = rejectIds.includes(ws.tplId);
                }
                return (
                  <button
                    key={`${ws.kind}-${ws.kind === 'entry' ? ws.tplId : ws.kind}`}
                    ref={idx === wizardIndex ? activeStepRef : undefined}
                    type="button"
                    className={isTrip ? 'is-trip' : undefined}
                    onClick={() => setWizardIndex(idx)}
                    style={{
                      flexShrink: 0,
                      border: needRedo ? '1px solid #ff4d4f' : isTrip ? undefined : 'none',
                      borderRadius: 12,
                      padding: '4px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                      background:
                        idx === wizardIndex
                          ? needRedo
                            ? '#ff4d4f'
                            : '#07c160'
                          : needRedo
                            ? '#fff1f0'
                            : done
                              ? '#e8f8ef'
                              : isTrip
                                ? '#eef8f3'
                                : '#f0f2f1',
                      color: idx === wizardIndex ? '#fff' : needRedo ? '#a8071a' : '#333',
                    }}
                  >
                    {idx + 1}.{ws.label}
                    {needRedo ? '!' : pendingAi ? '…' : done ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {currentWizard?.kind === 'start' && caseId && unitId && (
            <TripStartPanel
              caseId={caseId}
              unitId={unitId}
              form={tripForm}
              setForm={setTripForm}
              onPreview={(urls, index) => setPhotoPreview({ urls, index })}
            />
          )}

          {currentWizard?.kind === 'end' && caseId && unitId && (
            <TripEndPanel
              caseId={caseId}
              unitId={unitId}
              form={tripForm}
              setForm={setTripForm}
              onPreview={(urls, index) => setPhotoPreview({ urls, index })}
            />
          )}

          {currentTpl ? (
            <Cell.Group
              inset
              className="inspection-current-card"
              title={`检查项 ${
                currentWizard?.kind === 'entry' ? currentWizard.entryIndex + 1 : wizardIndex + 1
              }/${entriesTpl.length}`}
            >
              <Cell
                title={
                  <span>
                    {currentTpl.name}{' '}
                    {currentTpl.isRequired ? (
                      <Tag type="danger">必检</Tag>
                    ) : (
                      <Tag type="primary">选填</Tag>
                    )}
                    {((task.record?.rejectReason || record.rejectReason)?.entryIds || []).includes(
                      currentTpl.id,
                    ) ? (
                      <Tag type="danger" style={{ marginLeft: 4 }}>
                        需返工
                      </Tag>
                    ) : null}
                  </span>
                }
              />

              <div
                style={{
                  margin: '0 16px 12px',
                  padding: 12,
                  background: '#f7faf8',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#333',
                  lineHeight: 1.55,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>检查要求</div>
                {currentTpl.description || '请按现场规范完成检查并拍照。'}
              </div>

              <div className="inspection-media-section">
                <div className="inspection-media-heading">
                  <span>合格样本参考</span>
                  <small>点击可查看大图</small>
                </div>
                {(currentTpl.samplePhotos || []).length > 0 ? (
                  <div className="inspection-sample-grid">
                    {currentTpl.samplePhotos!.map((url, sampleIndex) => (
                      <Image
                        key={url}
                        src={displayPhotoUrl(url)}
                        width="100%"
                        height="100%"
                        fit="cover"
                        radius={12}
                        onClick={() =>
                          setPhotoPreview({
                            urls: currentTpl.samplePhotos || [],
                            index: sampleIndex,
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="inspection-media-empty">
                    暂无样本图，请按检查要求拍照
                  </div>
                )}
              </div>

              <div className="inspection-media-section inspection-photo-section">
                <div className="inspection-media-heading">
                  <span>现场照片</span>
                  <small>
                    {(currentEntry?.photos || []).length} 张已保存
                    {isFaultRecordItem(currentTpl)
                      ? '（须含实时+历史，至少 2 张）'
                      : isMountFixItem(currentTpl)
                        ? '（须多角度，至少 2 张）'
                        : ''}
                  </small>
                </div>
                <div className="inspection-photo-grid">
                  {(currentEntry?.photos || []).map((url, idx) => (
                    <PhotoThumbnail
                      key={`${url}-${idx}`}
                      url={url}
                      onClick={() =>
                        setPhotoPreview({
                          urls: currentEntry?.photos || [],
                          index: idx,
                        })
                      }
                      onRemove={() => handleRemovePhoto(url)}
                    />
                  ))}
                  {pendingPreview && (
                    <div className="inspection-photo-thumb is-pending">
                      <img src={pendingPreview} alt="待上传照片预览" />
                      <span>{uploading ? `${Math.max(1, uploadProgress)}%` : '待重试'}</span>
                    </div>
                  )}
                  {!pendingPreview && !(currentEntry?.photos || []).length && (
                    <div className="inspection-photo-placeholder">
                      <strong>＋</strong>
                      <span>添加第一张照片</span>
                    </div>
                  )}
                </div>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleCapture(f, 'camera');
                    e.target.value = '';
                  }}
                />
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const list = e.target.files ? Array.from(e.target.files) : [];
                    if (list.length) void handleCaptureFiles(list, 'gallery');
                    e.target.value = '';
                  }}
                />
                {uploadNotice && (
                  <div
                    className="inspection-upload-notice"
                    style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: uploadNotice.includes('没有完成') || uploadNotice.includes('超时') || uploadNotice.includes('失败')
                        ? '#fff4f2'
                        : '#eef8f3',
                      color: uploadNotice.includes('没有完成') || uploadNotice.includes('超时') || uploadNotice.includes('失败')
                        ? '#b33a2b'
                        : '#176b4d',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1 }}>{uploadNotice}</span>
                      {!uploading &&
                        lastFilesRef.current.length > 0 &&
                        (uploadNotice.includes('没有完成') ||
                          uploadNotice.includes('超时') ||
                          uploadNotice.includes('失败') ||
                          uploadNotice.includes('重试')) && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleCaptureFiles(
                                lastFilesRef.current,
                                uploadSource || 'gallery',
                              )
                            }
                            style={{
                              border: 'none',
                              borderRadius: 16,
                              padding: '6px 12px',
                              background: '#16835f',
                              color: '#fff',
                              fontWeight: 600,
                            }}
                          >
                            重新上传
                          </button>
                        )}
                    </div>
                    {uploading && (
                      <div
                        style={{
                          height: 5,
                          marginTop: 8,
                          overflow: 'hidden',
                          borderRadius: 3,
                          background: '#dcebe4',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.max(8, uploadProgress)}%`,
                            height: '100%',
                            borderRadius: 3,
                            background: '#16835f',
                            transition: 'width .2s ease',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="inspection-upload-actions">
                  <Button
                    plain
                    round
                    loading={uploading && uploadSource === 'gallery'}
                    disabled={uploading}
                    className="inspection-gallery-button"
                    onClick={() => galleryRef.current?.click()}
                  >
                    从相册选择（可多选）
                  </Button>
                  <Button
                    type="primary"
                    round
                    loading={uploading && uploadSource === 'camera'}
                    disabled={uploading}
                    className="inspection-camera-button"
                    onClick={() => cameraRef.current?.click()}
                  >
                    现场拍照
                  </Button>
                </div>
                <div className="inspection-upload-tip">
                  {locationStatus === 'ok'
                    ? isFaultRecordItem(currentTpl)
                      ? '定位已获取：请分别上传「实时故障」与「历史故障」截图（可相册多选），缺一类 AI 将判不合格'
                      : '定位已获取：相册可一次多选；现场拍照仍单张拍摄'
                    : locationStatus === 'weak'
                      ? '弱定位也可拍照上传；报告将标记弱定位'
                      : locationStatus === 'failed' || locationStatus === 'skipped'
                        ? '未定位也可拍照上传；报告将标记位置异常'
                        : '定位中也可先准备照片；无信号时可点「无法定位，继续作业」'}
                </div>
              </div>

              <div
                className="inspection-ai-note"
                style={{
                  margin: '0 16px 12px',
                  padding: 10,
                  background: '#f0f7ff',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#4a6a8a',
                  lineHeight: 1.5,
                }}
              >
                {isAnalyzing
                  ? 'AI 后台分析中，无需等待，直接点「下一步」即可。'
                  : currentEntry?.aiResult && aiStatus !== 'pending'
                    ? `智能分析：${RESULT_LABEL[aiStatus] || '待人工判断'}（稍后可在报告中查看详情）`
                    : '上传照片后 AI 将后台对比样本；全部拍完再提交，做完其他任务可回来看报告。'}
              </div>

              {(currentEntry?.photos || []).length > 0 && (
                <div className="inspection-manual-check">
                  <div className="inspection-manual-check__heading">
                    <div>
                      <strong>现场检查结论（选填）</strong>
                      <span>AI 仅供参考；如现场判断明确可选择，未选择不影响提交</span>
                    </div>
                    {currentEntry?.manualResult && currentEntry.manualResult !== 'pending' ? (
                      <Tag type={currentEntry.manualResult === 'fail' ? 'danger' : 'success'}>
                        已确认{RESULT_LABEL[currentEntry.manualResult]}
                      </Tag>
                    ) : (
                      <Tag>待确认</Tag>
                    )}
                  </div>
                  <div className="inspection-manual-check__actions">
                    <Button
                      round
                      className={currentEntry?.manualResult === 'pass' ? 'is-pass' : ''}
                      onClick={() => patchEntry({ manualResult: 'pass', finalResult: 'pass' })}
                    >
                      现场合格
                    </Button>
                    <Button
                      round
                      className={currentEntry?.manualResult === 'fail' ? 'is-fail' : ''}
                      onClick={() => patchEntry({ manualResult: 'fail', finalResult: 'fail' })}
                    >
                      现场不合格
                    </Button>
                  </div>
                </div>
              )}

              <Cell title="备注（可选）">
                <Input.TextArea
                  rows={2}
                  placeholder="可选备注"
                  value={currentEntry?.remark || ''}
                  onChange={(v) => patchEntry({ remark: v })}
                />
              </Cell>
            </Cell.Group>
          ) : currentWizard?.kind === 'start' || currentWizard?.kind === 'end' ? null : (
            <Empty description="无检查条目" />
          )}
            </>
          ) : null}
        </div>
      )}

      {task && record && showWorkSteps && currentWizard && (
        <div
          className="inspection-bottom-actions"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100,
            maxWidth: 640,
            margin: '0 auto',
            display: 'flex',
            gap: 8,
            padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
            background: '#fff',
            borderTop: '1px solid #e8eeea',
          }}
        >
          <Button
            round
            style={{ height: 48, flex: 1 }}
            disabled={wizardIndex <= 0 || uploading || saving || tripBusy}
            onClick={() => {
              if (uploading || tripBusy) {
                Toast.info('照片正在上传，请稍候');
                return;
              }
              setWizardIndex((s) => s - 1);
            }}
          >
            上一步
          </Button>
          {wizardIndex < wizardSteps.length - 1 ? (
            <Button
              round
              type="primary"
              disabled={uploading || saving || tripBusy}
              loading={tripBusy}
              style={{ height: 48, flex: 1.4 }}
              onClick={goNext}
            >
              下一步
            </Button>
          ) : (
            <Button
              round
              type="primary"
              disabled={uploading || saving || tripBusy}
              style={{ height: 48, flex: 1.4 }}
              loading={saving}
              onClick={() => void handleSubmit()}
            >
              提交报告
            </Button>
          )}
        </div>
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
