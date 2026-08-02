import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, Loading, Toast } from 'react-vant';
import {
  fetchMyFinanceCase,
  finishFinanceCase,
  saveFinanceCaseWork,
  startFinanceCase,
  uploadFinanceWorkPhoto,
  type MobileFinanceCase,
} from '../../api/finance';
import './finance.css';

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '未开始',
  in_progress: '巡检中',
  submitted: '已提交待审',
  approved: '巡检已通过',
  rejected: '已驳回·需返工',
};

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

  const load = async () => {
    const result = await fetchMyFinanceCase(id);
    setItem(result);
    setMileage(result.workRecord?.mileage || '0');
    setExpenses(result.workRecord?.expenses || '0');
    setWorkload(result.workRecord?.workload?.description || '');
    setNote(result.workRecord?.workNote || '');
    setPhotos(result.workRecord?.mileageScreenshotUrls || []);
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (!item)
    return (
      <div className="mobile-finance-page">
        <Loading vertical>加载案例...</Loading>
      </div>
    );

  const enterInspection = async (autoStart: boolean) => {
    setBusy(true);
    try {
      let current = item;
      if (autoStart && current.status === 'assigned') {
        current = await startFinanceCase(id);
        setItem(current);
      } else if (!current.inspectionTaskId) {
        current = await startFinanceCase(id);
        setItem(current);
      }
      const taskId = current.inspectionTaskId;
      if (!taskId) {
        Toast.fail('未找到巡检任务，请联系网格长确认任务类型');
        return;
      }
      navigate(`/m/inspection/${taskId}`);
    } catch {
      /* 拦截器 */
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    await saveFinanceCaseWork(id, {
      workload: {
        description: workload,
        templateName: item.taskTypeName || undefined,
      },
      mileage: Number(mileage || 0),
      expenses: Number(expenses || 0),
      workNote: note,
      mileageScreenshotUrls: photos,
    });
    Toast.success('已保存');
  };

  const canInspect = ['assigned', 'working'].includes(item.status) && !item.inspectionDone;
  const showSettleForm =
    item.status === 'working' && (item.inspectionDone || item.inspectionTaskStatus === 'submitted' || item.inspectionTaskStatus === 'approved');

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
        {item.inspectionTaskStatus && (
          <p className="mobile-finance-muted" style={{ marginTop: 6 }}>
            巡检进度：{TASK_STATUS_LABEL[item.inspectionTaskStatus] || item.inspectionTaskStatus}
          </p>
        )}

        {item.status === 'assigned' && (
          <button
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={() => void enterInspection(true)}
          >
            接单并开始 AI 巡检
          </button>
        )}

        {item.status === 'working' && canInspect && (
          <button
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={() => void enterInspection(false)}
          >
            {item.inspectionTaskStatus === 'rejected' ? '继续返工巡检' : '进入 AI 巡检'}
          </button>
        )}

        {item.status === 'working' && item.inspectionTaskId && item.inspectionDone && (
          <button
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => navigate(`/m/tasks/${item.inspectionTaskId}`)}
          >
            查看巡检报告
          </button>
        )}
      </section>

      {showSettleForm && (
        <section className="mobile-finance-card mobile-finance-form">
          <h3>里程与费用</h3>
          <p className="mobile-finance-muted">巡检报告已提交，请补齐里程截图后确认完工。</p>
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
                    message: '请确认 AI 巡检已提交、里程截图已齐全，完工后进入结算流程。',
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
      )}

      {item.status === 'working' && !item.inspectionDone && (
        <section className="mobile-finance-card">
          <h3>规范巡检流程</h3>
          <p className="mobile-finance-muted">
            点击上方按钮进入与临时巡检相同的规范流程：对照样本图拍照，系统异步 AI 分析合格/不合格。
          </p>
        </section>
      )}

      {!['assigned', 'working'].includes(item.status) && (
        <section className="mobile-finance-card">
          <h3>作业已提交</h3>
          <p className="mobile-finance-muted">可在「我的收入」查看核算与审核状态。</p>
          {item.inspectionTaskId && (
            <button
              className="mobile-finance-secondary"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => navigate(`/m/tasks/${item.inspectionTaskId}`)}
            >
              查看巡检报告
            </button>
          )}
        </section>
      )}
    </div>
  );
}
