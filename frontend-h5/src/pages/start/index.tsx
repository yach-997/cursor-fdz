import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Cell, Empty, Button, Toast, Tag } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchMyFinanceCases, type MobileFinanceCase } from '../../api/finance';

type Step = 'region' | 'project' | 'task';

const STATUS_TEXT: Record<string, string> = {
  assigned: '待开始',
  working: '作业中',
};

/** 开检向导：地区 → 站点 → 已派案例（不走设备台账） */
export default function StartWizardPage() {
  const navigate = useNavigate();
  const { user, setCurrentSite } = useAuthStore();
  const [step, setStep] = useState<Step>('region');
  const [region, setRegion] = useState('');
  const [projectId, setProjectId] = useState('');
  const [cases, setCases] = useState<MobileFinanceCase[]>([]);
  const [loading, setLoading] = useState(false);

  const sites = useMemo(
    () =>
      (user?.siteMemberships || [])
        .map((m) => m.site)
        .filter((s): s is NonNullable<typeof s> => !!s),
    [user],
  );

  const regions = useMemo(() => {
    // 仅按入职站点的省市区汇总，不要混入账号业务区域字段（如 yunnan/south_china）
    const set = new Set<string>();
    for (const s of sites) {
      const r = [s.province, s.city].filter(Boolean).join('') || '未分区';
      set.add(r);
    }
    return [...set];
  }, [sites]);

  const projects = useMemo(() => {
    return sites.filter((s) => {
      const r = [s.province, s.city].filter(Boolean).join('') || '未分区';
      return r === region;
    });
  }, [sites, region]);

  const loadCases = async (siteId: string) => {
    setLoading(true);
    try {
      const list = await fetchMyFinanceCases();
      const filtered = list.filter(
        (c) =>
          c.siteId === siteId &&
          ['assigned', 'working'].includes(c.status),
      );
      setCases(filtered);
      setStep('task');
      if (!filtered.length) {
        Toast.info('该站点暂无已派案例，请联系网格长派单');
      }
    } catch {
      /* 拦截器 */
    } finally {
      setLoading(false);
    }
  };

  const onPickRegion = (r: string) => {
    setRegion(r);
    setProjectId('');
    setCases([]);
    setStep('project');
  };

  const onPickProject = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (site) setCurrentSite(site);
    setProjectId(siteId);
    void loadCases(siteId);
  };

  const onBack = () => {
    if (step === 'project') setStep('region');
    else if (step === 'task') setStep('project');
    else navigate(-1);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f2f5f3', paddingBottom: 24 }}>
      <NavBar title="执行已派案例" leftText="返回" onClickLeft={onBack} />

      <div
        style={{
          margin: '12px 16px 0',
          padding: 12,
          borderRadius: 12,
          background: '#eaf6f1',
          color: '#47685c',
          fontSize: 12,
          lineHeight: 1.65,
        }}
      >
        作业均由网格长导入案例后派单。请选择地区与站点，进入已派给你的案例接单作业。
      </div>

      <div style={{ padding: '12px 16px', fontSize: 13, color: '#666' }}>
        {step === 'region' && '第 1 步：选择所在地区'}
        {step === 'project' && `第 2 步：选择站点（${region}）`}
        {step === 'task' && '第 3 步：选择已派案例'}
      </div>

      {step === 'region' && (
        <>
          {!regions.length ? (
            <Empty description="暂无可用地区，请先联系网格长聘用到站点" />
          ) : (
            <Cell.Group inset>
              {regions.map((r) => (
                <Cell
                  key={r}
                  title={r}
                  isLink
                  value={region === r ? '已选' : ''}
                  onClick={() => onPickRegion(r)}
                />
              ))}
            </Cell.Group>
          )}
          {!user?.realName || !user?.phone ? (
            <div style={{ margin: 16 }}>
              <Button block round plain type="primary" onClick={() => navigate('/m/settings')}>
                完善个人信息
              </Button>
            </div>
          ) : null}
        </>
      )}

      {step === 'project' && (
        <>
          {!projects.length ? (
            <Empty description="该地区暂无站点" />
          ) : (
            <Cell.Group inset>
              {projects.map((s) => (
                <Cell
                  key={s.id}
                  title={s.name}
                  label={`${s.code} · ${s.province || ''}${s.city || ''}`}
                  isLink
                  onClick={() => onPickProject(s.id)}
                />
              ))}
            </Cell.Group>
          )}
        </>
      )}

      {step === 'task' && (
        <>
          <div style={{ padding: '0 16px 8px', fontSize: 13, color: '#888' }}>
            {region} / {projects.find((p) => p.id === projectId)?.name}
          </div>
          {loading ? (
            <Empty description="加载案例中..." />
          ) : cases.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Empty description="暂无已派案例" />
              <Button block round style={{ marginTop: 12 }} onClick={() => setStep('project')}>
                重选站点
              </Button>
            </div>
          ) : (
            <Cell.Group inset>
              {cases.map((c) => (
                <Cell
                  key={c.id}
                  title={c.projectName || c.gspCaseNo}
                  label={`${c.gspCaseNo} · ${STATUS_TEXT[c.status] || c.status}`}
                  isLink
                  value={
                    <Tag type="primary">
                      {c.taskTypeName ||
                        (c.taskType === 'inspection'
                          ? '巡检'
                          : c.taskType === 'service'
                            ? '服务'
                            : c.taskType || '未设类型')}
                    </Tag>
                  }
                  onClick={() => navigate(`/m/finance-cases/${c.id}`)}
                />
              ))}
            </Cell.Group>
          )}
        </>
      )}
    </div>
  );
}
