import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Form, Field, Button, Toast, Cell } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { createTask } from '../../api/task';
import { fetchDevices, type DeviceItem } from '../../api/device';

const DEVICE_TYPE_LABEL: Record<string, string> = {
  string_inverter: '组串式逆变器',
  central_inverter: '集中式逆变器',
  energy_storage: '储能系统',
};

/** 巡检员创建任务：名称 + 现场 + 设备序列号 */
export default function CreateTaskPage() {
  const navigate = useNavigate();
  const { user, currentSite, setCurrentSite } = useAuthStore();
  const [taskName, setTaskName] = useState('');
  const [siteId, setSiteId] = useState(currentSite?.id || '');
  const [serialNumber, setSerialNumber] = useState('');
  const [device, setDevice] = useState<DeviceItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);

  const sites = useMemo(
    () =>
      (user?.siteMemberships || [])
        .map((m) => m.site)
        .filter((s): s is NonNullable<typeof s> => !!s),
    [user],
  );

  const lookupDevice = async () => {
    if (!siteId) {
      Toast.info('请先选择所属现场');
      return;
    }
    if (!serialNumber.trim()) {
      Toast.info('请输入设备序列号');
      return;
    }
    setLooking(true);
    try {
      const res = await fetchDevices({
        siteId,
        serialNumber: serialNumber.trim(),
        limit: 20,
      });
      const hit =
        res.list.find(
          (d) => d.serialNumber.toLowerCase() === serialNumber.trim().toLowerCase(),
        ) || res.list[0];
      if (!hit) {
        setDevice(null);
        Toast.info('未找到该序列号设备，请确认已建档');
        return;
      }
      setDevice(hit);
      setSerialNumber(hit.serialNumber);
      Toast.success('已匹配设备');
    } finally {
      setLooking(false);
    }
  };

  const submit = async () => {
    if (!taskName.trim()) {
      Toast.info('请填写任务名称');
      return;
    }
    if (!siteId) {
      Toast.info('请选择所属区域/现场');
      return;
    }
    if (!device && !serialNumber.trim()) {
      Toast.info('请填写并匹配设备序列号');
      return;
    }
    setSaving(true);
    try {
      const created = await createTask({
        taskName: taskName.trim(),
        siteId,
        deviceId: device?.id,
        serialNumber: serialNumber.trim(),
        aiEnabled: true,
      });
      Toast.success('任务已创建');
      navigate(`/m/inspection/${created.id}`, { replace: true });
    } catch {
      /* 拦截器 */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <NavBar title="临时新建巡检" leftText="返回" onClickLeft={() => navigate(-1)} />
      <div style={{ padding: '10px 16px', fontSize: 13, color: '#888' }}>
        适用于突发检查或尚未分配任务的现场。填写任务名称、所属区域/现场和设备序列号，匹配后自动带出设备类型。
      </div>
      <Form>
        <Field
          label="任务名称"
          required
          value={taskName}
          onChange={setTaskName}
          placeholder="如：组串逆变器现场巡检"
        />
      </Form>

      <Cell.Group inset title="所属区域/现场" style={{ marginTop: 12 }}>
        {sites.map((s) => (
          <Cell
            key={s.id}
            title={s.name}
            label={`${s.province || ''}${s.city || ''} · ${s.code}`}
            clickable
            value={siteId === s.id ? '已选' : ''}
            onClick={() => {
              setSiteId(s.id);
              setCurrentSite(s);
              setDevice(null);
            }}
          />
        ))}
        {!sites.length && <EmptyLike tip="暂无可用现场，请联系站长聘用" />}
      </Cell.Group>

      <Form style={{ marginTop: 12 }}>
        <Field
          label="设备序列号"
          required
          value={serialNumber}
          onChange={(v) => {
            setSerialNumber(v);
            setDevice(null);
          }}
          placeholder="输入后点右侧匹配"
          button={
            <Button size="small" type="primary" loading={looking} onClick={() => void lookupDevice()}>
              匹配
            </Button>
          }
        />
      </Form>

      {device && (
        <Cell.Group inset style={{ marginTop: 12 }}>
          <Cell title="设备类型" value={DEVICE_TYPE_LABEL[device.deviceType] || device.deviceType} />
          <Cell title="型号" value={device.model || '-'} />
        </Cell.Group>
      )}

      <div style={{ padding: 16 }}>
        <Button type="primary" block round loading={saving} onClick={() => void submit()}>
          创建并开始巡检
        </Button>
      </div>
    </div>
  );
}

function EmptyLike({ tip }: { tip: string }) {
  return <div style={{ padding: 16, color: '#999', fontSize: 13 }}>{tip}</div>;
}
