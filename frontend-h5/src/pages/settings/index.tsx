import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Form, Field, Button, Toast, Popup } from 'react-vant';
import { useAuthStore } from '../../stores/auth';
import { updateProfileApi, changePasswordApi } from '../../api/auth';
import './settings.css';

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员',
  site_manager: '网格长',
  inspector: '工程师',
};

const STATUS_LABEL: Record<string, string> = {
  active: '正常',
  disabled: '停用',
  inactive: '停用',
};

/** H5 设置：资料与改密 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, fetchMe } = useAuthStore();
  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  useEffect(() => {
    setRealName(user?.realName || '');
    setPhone(user?.phone || '');
    setEmail(user?.email || '');
    setRegion(user?.region || '');
  }, [user]);

  const roleText = useMemo(() => {
    const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
    return roles.map((r) => ROLE_LABEL[r] || r).join('、') || '-';
  }, [user]);

  const sitesText = useMemo(() => {
    const names = (user?.siteMemberships || [])
      .map((m) => m.site?.name)
      .filter(Boolean);
    return names.length ? names.join('、') : '暂无所属网格';
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

  const openPwd = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwdOpen(true);
  };

  const submitPwd = async () => {
    if (!oldPassword) {
      Toast.info('请输入原密码');
      return;
    }
    if (newPassword.length < 6) {
      Toast.info('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      Toast.info('两次新密码不一致');
      return;
    }
    setPwdSaving(true);
    try {
      await changePasswordApi(oldPassword, newPassword);
      Toast.success('密码已修改');
      setPwdOpen(false);
    } catch {
      /* 拦截器 */
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <NavBar title="个人资料" leftText="返回" onClickLeft={() => navigate(-1)} />

      <section className="settings-card">
        <div className="settings-avatar">{(user?.realName || user?.username || '?').slice(0, 1)}</div>
        <div className="settings-card-main">
          <h2>{user?.realName || user?.username || '-'}</h2>
          <p>{roleText}</p>
        </div>
      </section>

      <section className="settings-block">
        <h3>账号信息</h3>
        <ul className="settings-readonly">
          <li>
            <span>登录账号</span>
            <b>{user?.username || '-'}</b>
          </li>
          <li>
            <span>工号</span>
            <b>{user?.employeeNo || '-'}</b>
          </li>
          <li>
            <span>角色</span>
            <b>{roleText}</b>
          </li>
          <li>
            <span>状态</span>
            <b>{STATUS_LABEL[user?.status || ''] || user?.status || '-'}</b>
          </li>
          <li>
            <span>所属网格</span>
            <b className="settings-sites">{sitesText}</b>
          </li>
        </ul>
        <p className="settings-tip">账号、工号、角色由网格长建档，不可自行修改。</p>
      </section>

      <section className="settings-block">
        <h3>可编辑资料</h3>
        <Form>
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
            placeholder="如：广东省潮州市"
          />
          <Field label="邮箱" value={email} onChange={setEmail} placeholder="选填" />
        </Form>
      </section>

      <div className="settings-actions">
        <Button round block type="primary" loading={saving} onClick={() => void saveProfile()}>
          保存资料
        </Button>
        <Button round block plain hairline onClick={openPwd}>
          修改密码
        </Button>
      </div>

      <Popup
        visible={pwdOpen}
        position="bottom"
        round
        closeable
        title="修改密码"
        onClose={() => setPwdOpen(false)}
      >
        <div className="settings-pwd">
          <p className="settings-pwd-tip">在同一页填写原密码与新密码，一次提交即可。</p>
          <Form>
            <Field
              label="原密码"
              type="password"
              value={oldPassword}
              onChange={setOldPassword}
              placeholder="请输入原密码"
            />
            <Field
              label="新密码"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="至少 6 位"
            />
            <Field
              label="确认新密码"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="再输入一次新密码"
            />
          </Form>
          <Button
            round
            block
            type="primary"
            loading={pwdSaving}
            style={{ marginTop: 16 }}
            onClick={() => void submitPwd()}
          >
            确认修改
          </Button>
        </div>
      </Popup>
    </div>
  );
}
