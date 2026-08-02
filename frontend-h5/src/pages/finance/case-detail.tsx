import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, Loading, Switch, Toast } from 'react-vant';
import {
  fetchMyFinanceCase,
  finishFinanceCase,
  saveFinanceCaseWork,
  startFinanceCase,
  uploadFinanceWorkPhoto,
  type CaseChecklistItem,
  type MobileFinanceCase,
} from '../../api/finance';
import './finance.css';

export default function FinanceCaseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<MobileFinanceCase>();
  const [busy, setBusy] = useState(false);
  const [mileage, setMileage] = useState('0');
  const [expenses, setExpenses] = useState('0');
  const [workload, setWorkload] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<CaseChecklistItem[]>([]);

  const load = async () => {
    const result = await fetchMyFinanceCase(id);
    setItem(result);
    setMileage(result.workRecord?.mileage || '0');
    setExpenses(result.workRecord?.expenses || '0');
    setWorkload(result.workRecord?.workload?.description || '');
    setNote(result.workRecord?.workNote || '');
    setPhotos(result.workRecord?.mileageScreenshotUrls || []);
    setChecklist(
      result.checklist ||
        result.workRecord?.workload?.checklist ||
        (result.taskEntries || []).map((entry, index) => ({
          entryId: entry.id,
          name: entry.name,
          description: entry.description || '',
          isRequired: entry.isRequired !== false && !entry.isOptionalModule,
          isOptionalModule: !!entry.isOptionalModule,
          enabled: !entry.isOptionalModule,
          done: false,
          photoUrls: [],
          note: '',
          order: entry.order ?? index,
        })),
    );
  };

  useEffect(() => {
    void load();
  }, [id]);

  const progress = useMemo(() => {
    const active = checklist.filter((x) => x.enabled);
    const done = active.filter((x) => x.done).length;
    return { done, total: active.length };
  }, [checklist]);

  if (!item)
    return (
      <div className="mobile-finance-page">
        <Loading vertical>加载案例...</Loading>
      </div>
    );

  const patchChecklist = (entryId: string, patch: Partial<CaseChecklistItem>) => {
    setChecklist((prev) => prev.map((row) => (row.entryId === entryId ? { ...row, ...patch } : row)));
  };

  const save = async (nextChecklist = checklist) => {
    await saveFinanceCaseWork(id, {
      workload: {
        description: workload,
        checklist: nextChecklist,
        templateName: item.taskTypeName || undefined,
      },
      mileage: Number(mileage || 0),
      expenses: Number(expenses || 0),
      workNote: note,
      mileageScreenshotUrls: photos,
    });
    Toast.success('已保存');
  };

  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head">
        <button onClick={() => navigate('/m/finance-cases')}>← 返回</button>
        <h1>案例巡检</h1>
      </header>

      <section className="mobile-finance-card">
        <div className="mobile-finance-row">
          <h2>{item.projectName}</h2>
          <span className="mobile-finance-status">
            {item.status === 'assigned' ? '待开始' : item.status === 'working' ? '作业中' : '已完工'}
          </span>
        </div>
        <p className="mobile-finance-muted">{item.gspCaseNo}</p>
        <p>
          {item.province || '-'} · {item.city || '-'}
        </p>
        <p style={{ marginTop: 8 }}>
          任务类型：<b>{item.taskTypeName || item.taskType || '未设置'}</b>
        </p>
        {item.status === 'assigned' && (
          <button
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={async () => {
              await startFinanceCase(id);
              Toast.success('已开始作业，请按条目完成巡检');
              await load();
            }}
          >
            接单并开始巡检
          </button>
        )}
      </section>

      {item.status === 'working' && (
        <>
          <section className="mobile-finance-card">
            <div className="mobile-finance-row">
              <h3>检查条目</h3>
              <span className="mobile-finance-muted">
                {progress.done}/{progress.total}
              </span>
            </div>
            {!checklist.length && (
              <p className="mobile-finance-muted">暂无检查条目，请联系网格长确认任务类型。</p>
            )}
            {checklist.map((entry, index) => (
              <div key={entry.entryId} className="mobile-finance-check-item">
                <div className="mobile-finance-row">
                  <div>
                    <b>
                      {index + 1}. {entry.name}
                    </b>
                    <span className="mobile-finance-tag">
                      {entry.isOptionalModule ? '可选' : '必检'}
                    </span>
                  </div>
                  {entry.isOptionalModule && (
                    <Switch
                      size="20px"
                      checked={entry.enabled}
                      onChange={(checked) => patchChecklist(entry.entryId, { enabled: checked, done: checked ? entry.done : false })}
                    />
                  )}
                </div>
                {entry.description && <p className="mobile-finance-muted">{entry.description}</p>}
                {entry.enabled && (
                  <>
                    <label className="mobile-finance-check-done">
                      <input
                        type="checkbox"
                        checked={entry.done}
                        onChange={(e) => patchChecklist(entry.entryId, { done: e.target.checked })}
                      />
                      本项已完成
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setBusy(true);
                        try {
                          const result = await uploadFinanceWorkPhoto(id, file);
                          const next = checklist.map((row) =>
                            row.entryId === entry.entryId
                              ? { ...row, photoUrls: [...row.photoUrls, result.url].slice(0, 9), done: true }
                              : row,
                          );
                          setChecklist(next);
                          await save(next);
                          Toast.success('照片已上传');
                        } finally {
                          setBusy(false);
                          event.target.value = '';
                        }
                      }}
                    />
                    <div>
                      {entry.photoUrls.map((url, i) => (
                        <img className="mobile-finance-photo" src={url} key={`${url}-${i}`} alt={entry.name} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </section>

          <section className="mobile-finance-card mobile-finance-form">
            <h3>里程与费用</h3>
            <label>工作量说明</label>
            <textarea
              rows={3}
              value={workload}
              onChange={(e) => setWorkload(e.target.value)}
              placeholder="补充现场工作说明"
            />
            <label>行驶里程（公里）</label>
            <input type="number" min="0" step="0.1" value={mileage} onChange={(e) => setMileage(e.target.value)} />
            <label>现场费用（元）</label>
            <input type="number" min="0" step="0.01" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
            <label>作业备注</label>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="可填写现场情况" />
            <label>里程截图（必传）</label>
            <input
              type="file"
              accept="image/*"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  const result = await uploadFinanceWorkPhoto(id, file);
                  setPhotos((old) => [...old, result.url]);
                  Toast.success('截图上传成功');
                } finally {
                  setBusy(false);
                  event.target.value = '';
                }
              }}
            />
            {busy && <p className="mobile-finance-muted">正在上传...</p>}
            <div>
              {photos.map((url, index) => (
                <img className="mobile-finance-photo" src={url} key={`${url}-${index}`} alt="里程截图" />
              ))}
            </div>
            <div className="mobile-finance-actions">
              <button className="mobile-finance-secondary" onClick={() => void save()}>
                保存记录
              </button>
              <button
                className="mobile-finance-primary"
                onClick={async () => {
                  await save();
                  try {
                    await Dialog.confirm({
                      title: '确认完工',
                      message: '请确认检查条目与里程截图已齐全，完工后进入结算流程。',
                    });
                  } catch {
                    return;
                  }
                  await finishFinanceCase(id);
                  Toast.success('案例已完工');
                  navigate('/m/finance-cases', { replace: true });
                }}
              >
                确认完工
              </button>
            </div>
          </section>
        </>
      )}

      {!['assigned', 'working'].includes(item.status) && (
        <section className="mobile-finance-card">
          <h3>作业已提交</h3>
          <p className="mobile-finance-muted">可在「我的收入」查看核算与审核状态。</p>
        </section>
      )}
    </div>
  );
}
