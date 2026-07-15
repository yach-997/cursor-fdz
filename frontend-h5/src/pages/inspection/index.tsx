import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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

const RESULT_LABEL: Record<string, string> = {
  pass: '合格',
  fail: '不合格',
  pending: '分析中/待确认',
  error: 'AI失败·待人工',
};

interface LiveLocationProof {
  gps: string;
  accuracy: string;
  capturedAt: string;
}

function getLiveLocation(): Promise<LiveLocationProof> {
  if (!('geolocation' in navigator)) {
    return Promise.reject(new Error('当前设备不支持定位'));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          gps: `${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)}`,
          accuracy: String(Math.max(1, Math.round(position.coords.accuracy))),
          capturedAt: new Date().toISOString(),
        }),
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? '定位权限未开启，请在浏览器设置中允许定位'
            : '现场定位失败，请到开阔处重新定位';
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

/** 巡检执行：要求提示 + 样本图 + 拍照/相册 + 异步AI + 必填校验提交 */
export default function InspectionPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskItem | null>(null);
  const [record, setRecord] = useState<RecordItem | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSource, setUploadSource] = useState<'camera' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadNotice, setUploadNotice] = useState('');
  const [locationStatus, setLocationStatus] = useState<
    'checking' | 'verified' | 'blocked'
  >('checking');
  const [locationResult, setLocationResult] = useState<LocationVerification | null>(
    null,
  );
  const [locationError, setLocationError] = useState('正在确认是否到达巡检现场…');
  const cameraRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const locationProofRef = useRef<LiveLocationProof | null>(null);
  const pollRefs = useRef<Record<string, number>>({});
  const activeEntryRef = useRef<string | undefined>(undefined);
  const rejectJumpedRef = useRef(false);
  /** 正在 AI 分析的条目，不阻塞其他条目 */
  const [analyzingIds, setAnalyzingIds] = useState<string[]>([]);

  const verifyLocation = useCallback(async () => {
    if (!taskId) throw new Error('缺少巡检任务');
    setLocationStatus('checking');
    setLocationError('正在获取高精度现场定位…');
    try {
      const proof = await getLiveLocation();
      const result = await checkTaskLocation({ taskId, ...proof });
      locationProofRef.current = proof;
      setLocationResult(result);
      setLocationStatus('verified');
      setLocationError('');
      return proof;
    } catch (error) {
      const message = error instanceof Error ? error.message : '现场定位校验失败';
      locationProofRef.current = null;
      setLocationResult(null);
      setLocationStatus('blocked');
      setLocationError(message);
      throw error;
    }
  }, [taskId]);

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

  const currentTpl = entriesTpl[step];
  const currentEntry = record?.entries.find(
    (e) => e.templateEntryId === currentTpl?.id,
  );

  useEffect(() => {
    activeEntryRef.current = currentTpl?.id;
    setUploadNotice('');
    setUploadProgress(0);
    lastFileRef.current = null;
  }, [currentTpl?.id]);

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
      navigate('/m/tasks', { replace: true });
    },
    [navigate, record],
  );

  const onClickBack = () => {
    // 离开时自动保存进度，任务停留在「进行中」，可再点继续
    void leavePage(true);
  };

  const load = useCallback(async () => {
    if (!taskId) return;
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
  }, [taskId]);

  useEffect(() => {
    load()
      .then(() => undefined)
      .catch(() => Toast.info('加载失败'));
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
      setStep(idx);
    }
  }, [task, record, entriesTpl]);

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
      if (tries > 24) {
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

  const handleCapture = async (file: File) => {
    if (!record || !currentTpl || !taskId) return;
    lastFileRef.current = file;
    setUploadSource('camera');
    setUploadProgress(0);
    setUploadNotice('正在优化照片并获取定位…');
    setUploading(true);
    let uploadCompleted = false;
    const capturedRecordId = record.id;
    const capturedEntryId = currentTpl.id;
    const capturedSamplePhotos = currentTpl.samplePhotos || [];
    try {
      const currentProof = locationProofRef.current;
      const proofPromise: Promise<LiveLocationProof> =
        currentProof && Date.now() - Date.parse(currentProof.capturedAt) < 120_000
          ? Promise.resolve(currentProof)
          : verifyLocation();
      const [compressed, proof] = await Promise.all([
        compressImage(file),
        proofPromise,
      ]);

      setUploadNotice('正在安全上传照片…');
      const uploaded = await uploadPhoto(
        compressed,
        {
          taskId,
          ...proof,
          photoTakenAt: new Date(file.lastModified || Date.now()).toISOString(),
        },
        (percent) => {
          setUploadProgress(percent);
          if (percent >= 99) {
            setUploadNotice('照片已传送，云端正在添加水印并保存…');
          }
        },
      );
      const photos = [...(currentEntry?.photos || []), uploaded.url];
      uploadCompleted = true;
      setUploadProgress(100);
      patchEntry({ photos });
      const entriesSnapshot = record.entries.map((entry) =>
        entry.templateEntryId === capturedEntryId ? { ...entry, photos } : entry,
      );
      localStorage.setItem(`draft:${capturedRecordId}`, JSON.stringify(entriesSnapshot));
      setUploading(false);
      setUploadNotice('照片已上传，可以继续下一步；正在后台保存…');

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
            setUploadNotice('照片已安全保存');
          }

          if (task?.aiEnabled !== false) {
            setAnalyzingIds((ids) =>
              ids.includes(capturedEntryId) ? ids : [...ids, capturedEntryId],
            );
            try {
              await analyzeAi({
                recordId: capturedRecordId,
                templateEntryId: capturedEntryId,
                photoUrl: uploaded.url,
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
      setUploadNotice(
        message.includes('timeout')
          ? '网络响应超时，请点击重试，不会丢失已选照片'
          : '上传没有完成，请检查网络后重试',
      );
    } finally {
      if (!uploadCompleted) setUploading(false);
    }
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
      if (!entry?.photos?.length) {
        missing.push(`「${tpl.name}」未拍照`);
      }
    }
    return missing;
  };

  const goNext = () => {
    if (uploading) {
      Toast.info('照片正在上传，请稍候');
      return;
    }
    const mustPhoto =
      !!currentTpl &&
      (currentTpl.isOptionalModule || currentTpl.isRequired !== false);
    if (mustPhoto && !(currentEntry?.photos || []).length) {
      Toast.info('请先上传本项照片');
      return;
    }
    void handleSaveDraft(true);
    setStep((s) => s + 1);
  };

  const handleSubmit = async () => {
    if (!record) return;
    if (uploading) {
      Toast.info('照片正在上传，请稍候');
      return;
    }
    const mustCurrent =
      !!currentTpl &&
      (currentTpl.isOptionalModule || currentTpl.isRequired !== false);
    if (mustCurrent && !(currentEntry?.photos || []).length) {
      Toast.info('请先上传本项照片');
      return;
    }
    const missing = requiredIncomplete();
    if (missing.length) {
      Toast.info(missing[0]);
      const firstName = missing[0].match(/「(.+?)」/)?.[1];
      if (firstName) {
        const idx = entriesTpl.findIndex((e) => e.name === firstName);
        if (idx >= 0) setStep(idx);
      }
      return;
    }
    try {
      const proof = await verifyLocation();
      await Dialog.confirm({
        title: '提交报告',
        message:
          task?.aiEnabled === false
            ? '照片已齐。提交后将进入管理员人工审核。'
            : '照片已齐。提交后 AI 将在后台继续分析，你可去做其他巡检，稍后再看报告结果。',
      });
      setSaving(true);
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
        ...proof,
      });
      localStorage.removeItem(`draft:${saved.id}`);
      localStorage.removeItem(`optmod:${saved.id}`);
      navigate('/m/success', {
        state: { recordId: submitted.id, taskName: task?.taskName },
      });
    } catch {
      /* cancel 或拦截器已提示 */
    } finally {
      setSaving(false);
    }
  };

  const aiStatus = currentEntry?.aiResult?.status || 'pending';
  const isAnalyzing = currentTpl ? analyzingIds.includes(currentTpl.id) : false;

  return (
    <div style={{ paddingBottom: 96, minHeight: '100vh', background: '#f2f5f3' }}>
      <div
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
            巡检执行
          </div>
        </div>
      </div>

      {!task || !record ? (
        <Empty description="加载中..." />
      ) : (
        <div style={{ padding: 12 }}>
          <Cell
            title={task.taskName}
            label={`SN: ${task.device?.serialNumber || '-'} · 现场定位通过后拍照巡检`}
          />

          <div
            style={{
              marginTop: 12,
              padding: '14px 14px 13px',
              borderRadius: 12,
              border: `1px solid ${
                locationStatus === 'verified'
                  ? '#b8e2cf'
                  : locationStatus === 'blocked'
                    ? '#f2c2ba'
                    : '#d9e4df'
              }`,
              background:
                locationStatus === 'verified'
                  ? '#eef9f4'
                  : locationStatus === 'blocked'
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
                    locationStatus === 'verified'
                      ? '#16835f'
                      : locationStatus === 'blocked'
                        ? '#d95645'
                        : '#80948a',
                  color: '#fff',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {locationStatus === 'verified'
                  ? '✓'
                  : locationStatus === 'blocked'
                    ? '!'
                    : '⌖'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#173d2f' }}>
                  {locationStatus === 'verified'
                    ? '已到达巡检现场'
                    : locationStatus === 'blocked'
                      ? '暂时无法开始拍照'
                      : '正在校验现场位置'}
                </div>
                <div style={{ marginTop: 3, color: '#687a72', fontSize: 12 }}>
                  {locationStatus === 'verified' && locationResult
                    ? `距站点约 ${locationResult.distanceMeters} 米 · 定位精度约 ${locationResult.accuracyMeters} 米`
                    : locationError}
                </div>
              </div>
              <button
                type="button"
                disabled={locationStatus === 'checking'}
                onClick={() => void verifyLocation().catch(() => undefined)}
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
            <div style={{ marginTop: 10, color: '#7b8983', fontSize: 11, lineHeight: 1.5 }}>
              巡检员须在站点 {locationResult?.radiusMeters || 500} 米范围内，拍照和提交时都会再次校验定位。
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
                          // 开启后跳到该项
                          const idx = allEntriesTpl
                            .filter(
                              (e) =>
                                !e.isOptionalModule ||
                                [...enabledOptionalIds, m.id].includes(e.id),
                            )
                            .findIndex((e) => e.id === m.id);
                          if (idx >= 0) setStep(idx);
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
            style={{
              margin: '12px 0',
              padding: '12px 14px',
              background: '#fff',
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              进度 {step + 1} / {entriesTpl.length || 0}
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
                  width: `${entriesTpl.length ? ((step + 1) / entriesTpl.length) * 100 : 0}%`,
                  background: '#07c160',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {entriesTpl.map((e, idx) => {
                const entry = record.entries.find((x) => x.templateEntryId === e.id);
                const done = !!entry?.photos?.length;
                const pendingAi = analyzingIds.includes(e.id);
                const rejectIds =
                  (task.record?.rejectReason || record.rejectReason)?.entryIds || [];
                const needRedo = rejectIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setStep(idx)}
                    style={{
                      border: needRedo ? '1px solid #ff4d4f' : 'none',
                      borderRadius: 12,
                      padding: '4px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: idx === step ? (needRedo ? '#ff4d4f' : '#07c160') : needRedo ? '#fff1f0' : done ? '#e8f8ef' : '#f0f2f1',
                      color: idx === step ? '#fff' : needRedo ? '#a8071a' : '#333',
                    }}
                  >
                    {idx + 1}.{e.name}
                    {needRedo ? '!' : pendingAi ? '…' : done ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {currentTpl ? (
            <Cell.Group inset title={`检查项 ${step + 1}/${entriesTpl.length}`}>
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

              <Cell title="合格样本参考">
                {(currentTpl.samplePhotos || []).length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {currentTpl.samplePhotos!.map((url) => (
                      <Image
                        key={url}
                        src={displayPhotoUrl(url)}
                        width={88}
                        height={88}
                        fit="cover"
                        radius={6}
                        onClick={() =>
                          navigate(`/m/photo?url=${encodeURIComponent(url)}&index=0`)
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 8, color: '#999', fontSize: 13 }}>
                    暂无样本图，请按检查要求拍照
                  </div>
                )}
              </Cell>

              <Cell title="现场照片">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {(currentEntry?.photos || []).map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      style={{ position: 'relative', width: 88, height: 88 }}
                    >
                      <Image
                        src={displayPhotoUrl(url)}
                        width={88}
                        height={88}
                        fit="cover"
                        radius={6}
                        onClick={() =>
                          navigate(
                            `/m/photo?${(currentEntry?.photos || [])
                              .map((u) => `url=${encodeURIComponent(u)}`)
                              .join('&')}&index=${idx}`,
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="删除照片"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePhoto(url);
                        }}
                        style={{
                          position: 'absolute',
                          top: -6,
                          right: -6,
                          width: 22,
                          height: 22,
                          border: 'none',
                          borderRadius: 11,
                          background: 'rgba(0,0,0,.65)',
                          color: '#fff',
                          fontSize: 14,
                          lineHeight: '22px',
                          padding: 0,
                          cursor: 'pointer',
                          zIndex: 2,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleCapture(f);
                    e.target.value = '';
                  }}
                />
                {uploadNotice && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: uploadNotice.includes('没有完成') || uploadNotice.includes('超时')
                        ? '#fff4f2'
                        : '#eef8f3',
                      color: uploadNotice.includes('没有完成') || uploadNotice.includes('超时')
                        ? '#b33a2b'
                        : '#176b4d',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1 }}>{uploadNotice}</span>
                      {!uploading &&
                        lastFileRef.current &&
                        (uploadNotice.includes('没有完成') || uploadNotice.includes('超时')) && (
                          <button
                            type="button"
                            onClick={() => void handleCapture(lastFileRef.current!)}
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
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button
                    type="primary"
                    round
                    loading={uploading && uploadSource === 'camera'}
                    disabled={uploading || locationStatus !== 'verified'}
                    style={{ flex: 1, height: 48 }}
                    onClick={() => cameraRef.current?.click()}
                  >
                    {locationStatus === 'verified' ? '现场拍照' : '定位通过后拍照'}
                  </Button>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    textAlign: 'center',
                    color: '#88958f',
                    fontSize: 11,
                  }}
                >
                  为防止上传旧照片，巡检任务仅支持现场调用相机拍摄
                </div>
              </Cell>

              <div
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
                    ? `AI：${RESULT_LABEL[aiStatus] || aiStatus}（稍后可在报告中查看详情）`
                    : '上传照片后 AI 将后台对比样本；全部拍完再提交，做完其他任务可回来看报告。'}
              </div>

              <Cell title="备注（可选）">
                <Input.TextArea
                  rows={2}
                  placeholder="可选备注"
                  value={currentEntry?.remark || ''}
                  onChange={(v) => patchEntry({ remark: v })}
                />
              </Cell>
            </Cell.Group>
          ) : (
            <Empty description="无检查条目" />
          )}
        </div>
      )}

      <div
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
          disabled={step <= 0}
          onClick={() => {
            if (uploading) {
              Toast.info('照片正在上传，请稍候');
              return;
            }
            setStep((s) => s - 1);
          }}
        >
          上一步
        </Button>
        {step < entriesTpl.length - 1 ? (
          <Button
            round
            type="primary"
            disabled={uploading}
            style={{ height: 48, flex: 1.4 }}
            onClick={goNext}
          >
            下一步
          </Button>
        ) : (
          <Button
            round
            type="primary"
            disabled={uploading}
            style={{ height: 48, flex: 1.4 }}
            loading={saving}
            onClick={() => void handleSubmit()}
          >
            提交报告
          </Button>
        )}
      </div>
    </div>
  );
}
