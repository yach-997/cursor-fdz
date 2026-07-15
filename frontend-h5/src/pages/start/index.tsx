import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Cell, Empty, Button, Toast, Tag } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { fetchTasks, type TaskItem } from '../../api/task';

const DEVICE_TYPES = [
  { value: 'string_inverter', label: '组串式逆变器' },
  { value: 'central_inverter', label: '集中式逆变器' },
  { value: 'energy_storage', label: '储能系统' },
] as const;

type Step = 'region' | 'project' | 'device' | 'task';

const STATUS_TEXT: Record<string, string> = {
  pending: '待办',
  in_progress: '进行中',
};

/** 开检向导：地区 → 巡检项目(站点) → 设备类型 → 任务 */
export default function StartWizardPage() {
  const navigate = useNavigate();
  const { user, setCurrentSite } = useAuthStore();
  const [step, setStep] = useState<Step>('region');
  const [region, setRegion] = useState('');
  const [projectId, setProjectId] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);

  const sites = useMemo(
    () =>
      (user?.siteMemberships || [])
        .map((m) => m.site)
        .filter((s): s is NonNullable<typeof s> => !!s),
    [user],
  );

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sites) {
      const r = [s.province, s.city].filter(Boolean).join('') || '未分区';
      set.add(r);
    }
    if (user?.region) set.add(user.region);
    return [...set];
  }, [sites, user?.region]);

  const projects = useMemo(() => {
    return sites.filter((s) => {
      const r = [s.province, s.city].filter(Boolean).join('') || '未分区';
      return r === region;
    });
  }, [sites, region]);

  const loadTasks = async (siteId: string, dt: string) => {
    setLoading(true);
    try {
      const res = await fetchTasks({
        page: 1,
        limit: 50,
        siteId,
        deviceType: dt,
      });
      const list = res.list.filter((t) =>
        ['pending', 'in_progress', 'rejected'].includes(t.status),
      );
      setTasks(list);
      setStep('task');
      if (!list.length) {
        Toast.info('该条件下暂无待办任务，请联系站长分配');
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
    setDeviceType('');
    setTasks([]);
    setStep('project');
  };

  const onPickProject = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (site) setCurrentSite(site);
    setProjectId(siteId);
    setDeviceType('');
    setTasks([]);
    setStep('device');
  };

  const onPickDevice = (dt: string) => {
    setDeviceType(dt);
    void loadTasks(projectId, dt);
  };

  const onBack = () => {
    if (step === 'region') {
      navigate('/m', { replace: true });
      return;
    }
    if (step === 'project') setStep('region');
    else if (step === 'device') setStep('project');
    else setStep('device');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f2f5f3', paddingBottom: 24 }}>
      <NavBar
        title="执行待办任务"
        leftText="返回"
        rightText="临时新建"
        onClickLeft={onBack}
        onClickRight={() => navigate('/m/tasks/create')}
      />

      <div style={{ margin: '12px 16px 0', padding: 12, borderRadius: 12, background: '#eaf6f1', color: '#47685c', fontSize: 12, lineHeight: 1.65 }}>
        这里用于执行管理员或站长已分配的待办任务；突发检查或现场漏建任务时，可点右上角“临时新建”。
      </div>

      <div style={{ padding: '12px 16px', fontSize: 13, color: '#666' }}>
        {step === 'region' && '第 1 步：选择所在地区'}
        {step === 'project' && `第 2 步：选择巡检项目（${region}）`}
        {step === 'device' && '第 3 步：选择设备类型'}
        {step === 'task' && '第 4 步：选择待办任务进入检查流程'}
      </div>

      {step === 'region' && (
        <>
          {!regions.length ? (
            <Empty description="暂无可用地区，请先联系站长聘用到站点" />
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
            <Empty description="该地区暂无巡检项目" />
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

      {step === 'device' && (
        <Cell.Group inset>
          {DEVICE_TYPES.map((d) => (
            <Cell
              key={d.value}
              title={d.label}
              isLink
              onClick={() => onPickDevice(d.value)}
            />
          ))}
        </Cell.Group>
      )}

      {step === 'task' && (
        <>
          <div style={{ padding: '0 16px 8px', fontSize: 13, color: '#888' }}>
            {region} / {projects.find((p) => p.id === projectId)?.name} /{' '}
            {DEVICE_TYPES.find((d) => d.value === deviceType)?.label}
          </div>
          {loading ? (
            <Empty description="加载任务中..." />
          ) : tasks.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Empty description="暂无匹配任务" />
              <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                <Button block round onClick={() => setStep('device')}>
                  重选设备类型
                </Button>
                <Button block round type="primary" onClick={() => navigate('/m/tasks/create')}>
                  临时新建巡检任务
                </Button>
              </div>
            </div>
          ) : (
            <Cell.Group inset>
              {tasks.map((t) => (
                <Cell
                  key={t.id}
                  title={t.taskName}
                  label={`序列号：${t.device?.serialNumber || '-'} · ${STATUS_TEXT[t.status] || '未知状态'}`}
                  isLink
                  value={
                    <Tag type={t.status === 'in_progress' ? 'primary' : 'success'} plain>
                      {STATUS_TEXT[t.status] || '未知状态'}
                    </Tag>
                  }
                  onClick={() => navigate(`/m/inspection/${t.id}`)}
                />
              ))}
            </Cell.Group>
          )}
        </>
      )}
    </div>
  );
}
