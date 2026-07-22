import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Form, Field, Button, Toast, Dialog } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { updateProfileApi, changePasswordApi } from '../../api/auth';

/** H5 设置：资料与改密（工程师可完善个人信息） */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, fetchMe } = useAuthStore();
  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRealName(user?.realName || '');
    setPhone(user?.phone || '');
    setEmail(user?.email || '');
    setRegion(user?.region || '');
  }, [user]);

  const saveProfile = async () => {
    if (!realName.trim()) {
      Toast.info('请填写姓名');
      return;
    }
    if (!phone.trim()) {
      Toast.info('请填写手机号');
      return;
    }
    setSaving(true);
    try {
      await updateProfileApi({
        realName: realName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        region: region.trim() || undefined,
      });
      await fetchMe();
      Toast.success('资料已保存');
    } finally {
      setSaving(false);
    }
  };

  const changePwd = async () => {
    try {
      await Dialog.confirm({ title: '修改密码', message: '请在下一步输入原密码与新密码' });
    } catch {
      return;
    }
    const oldPassword = window.prompt('原密码');
    if (!oldPassword) return;
    const newPassword = window.prompt('新密码（至少6位）');
    if (!newPassword || newPassword.length < 6) {
      Toast.info('新密码至少 6 位');
      return;
    }
    try {
      await changePasswordApi(oldPassword, newPassword);
      Toast.success('密码已修改');
    } catch {
      /* 拦截器提示 */
    }
  };

  return (
    <div>
      <NavBar title="个人资料" leftText="返回" onClickLeft={() => navigate(-1)} />
      <div style={{ padding: '10px 16px', fontSize: 13, color: '#888' }}>
        请完善个人信息，便于站长联系与派工。支持手机浏览器与微信内打开。
      </div>
      <Form style={{ marginTop: 4 }}>
        <Field
          label="姓名"
          required
          value={realName}
          onChange={setRealName}
          placeholder="真实姓名"
        />
        <Field
          label="手机号"
          required
          value={phone}
          onChange={setPhone}
          placeholder="联系手机"
          type="tel"
        />
        <Field
          label="所属地区"
          value={region}
          onChange={setRegion}
          placeholder="如：四川省自贡市"
        />
        <Field label="邮箱" value={email} onChange={setEmail} placeholder="选填" />
      </Form>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Button round block type="primary" loading={saving} onClick={() => void saveProfile()}>
          保存资料
        </Button>
        <Button round block plain onClick={() => void changePwd()}>
          修改密码
        </Button>
      </div>
    </div>
  );
}
