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
  useEffect(() => { void load(); }, [id]);
  if (!item) return <div className="mobile-finance-page"><Loading vertical>加载案例...</Loading></div>;

  const save = async () => {
    await saveFinanceCaseWork(id, {
      workload: { description: workload }, mileage: Number(mileage || 0), expenses: Number(expenses || 0), workNote: note, mileageScreenshotUrls: photos,
    });
    Toast.success('工作记录已保存');
  };
  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head"><button onClick={() => navigate('/m/finance-cases')}>← 返回</button><h1>案例作业</h1></header>
      <section className="mobile-finance-card">
        <div className="mobile-finance-row"><h2>{item.projectName}</h2><span className="mobile-finance-status">{item.status === 'assigned' ? '待开始' : item.status === 'working' ? '作业中' : '已完工'}</span></div>
        <p className="mobile-finance-muted">{item.gspCaseNo}</p><p>{item.province || '-'} · {item.city || '-'}</p>
        {item.status === 'assigned' && <button className="mobile-finance-primary" style={{ width: '100%' }} onClick={async () => { await startFinanceCase(id); Toast.success('已开始作业'); await load(); }}>接单并开始作业</button>}
      </section>
      {item.status === 'working' && (
        <section className="mobile-finance-card mobile-finance-form">
          <h3>现场工作记录</h3>
          <label>工作量说明</label><textarea rows={3} value={workload} onChange={(e) => setWorkload(e.target.value)} placeholder="填写更换、维修或检查工作量" />
          <label>行驶里程（公里）</label><input type="number" min="0" step="0.1" value={mileage} onChange={(e) => setMileage(e.target.value)} />
          <label>现场费用（元）</label><input type="number" min="0" step="0.01" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
          <label>作业备注</label><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="可填写现场情况与费用说明" />
          <label>里程截图（必传）</label>
          <input type="file" accept="image/*" onChange={async (event) => {
            const file = event.target.files?.[0]; if (!file) return;
            setBusy(true);
            try { const result = await uploadFinanceWorkPhoto(id, file); setPhotos((old) => [...old, result.url]); Toast.success('截图上传成功'); }
            finally { setBusy(false); event.target.value = ''; }
          }} />
          {busy && <p className="mobile-finance-muted">正在上传...</p>}
          <div>{photos.map((url, index) => <img className="mobile-finance-photo" src={url} key={`${url}-${index}`} alt="里程截图" />)}</div>
          <div className="mobile-finance-actions">
            <button className="mobile-finance-secondary" onClick={() => void save()}>保存记录</button>
            <button className="mobile-finance-primary" onClick={async () => {
              await save();
              try { await Dialog.confirm({ title: '确认完工', message: '完工后案例将进入结算流程，确认提交？' }); } catch { return; }
              await finishFinanceCase(id); Toast.success('案例已完工'); navigate('/m/finance-cases', { replace: true });
            }}>确认完工</button>
          </div>
        </section>
      )}
      {!['assigned','working'].includes(item.status) && <section className="mobile-finance-card"><h3>作业已提交</h3><p className="mobile-finance-muted">可在“我的收入”查看核算与审核状态。</p></section>}
    </div>
  );
}
