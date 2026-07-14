import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Tabs, message, Descriptions, Tag } from 'antd';
import { useAuthStore } from '../../stores/auth';
import { updateProfileApi, changePasswordApi } from '../../api/auth';
import { ROLE_LABEL } from '../../types';

/** 系统设置：个人资料 + 修改密码 */
export default function SettingsPage() {
  const { user, fetchMe } = useAuthStore();
  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    if (user) {
      profileForm.setFieldsValue({
        realName: user.realName,
        phone: user.phone,
        email: user.email,
        region: user.region,
      });
    }
  }, [user, profileForm]);

  const saveProfile = async () => {
    const values = await profileForm.validateFields();
    setSavingProfile(true);
    try {
      await updateProfileApi(values);
      await fetchMe();
      message.success('资料已更新');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    const values = await pwdForm.validateFields();
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    setSavingPwd(true);
    try {
      await changePasswordApi(values.oldPassword, values.newPassword);
      message.success('密码已修改，请妥善保管');
      pwdForm.resetFields();
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="角色">
            <Tag>{user?.role ? ROLE_LABEL[user.role] : '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="账号状态">
            {user?.status === 'active' ? '正常' : '停用'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        items={[
          {
            key: 'profile',
            label: '个人资料',
            children: (
              <Card>
                <Form form={profileForm} layout="vertical" style={{ maxWidth: 480 }}>
                  <Form.Item name="realName" label="姓名" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="phone" label="手机号" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="email" label="邮箱">
                    <Input type="email" />
                  </Form.Item>
                  <Form.Item name="region" label="区域">
                    <Input placeholder="如：华东 / 华北" />
                  </Form.Item>
                  <Button type="primary" loading={savingProfile} onClick={() => void saveProfile()}>
                    保存资料
                  </Button>
                </Form>
              </Card>
            ),
          },
          {
            key: 'password',
            label: '修改密码',
            children: (
              <Card>
                <Form form={pwdForm} layout="vertical" style={{ maxWidth: 480 }}>
                  <Form.Item
                    name="oldPassword"
                    label="原密码"
                    rules={[{ required: true, message: '请输入原密码' }]}
                  >
                    <Input.Password />
                  </Form.Item>
                  <Form.Item
                    name="newPassword"
                    label="新密码"
                    rules={[{ required: true, min: 6, message: '至少 6 位' }]}
                  >
                    <Input.Password />
                  </Form.Item>
                  <Form.Item
                    name="confirmPassword"
                    label="确认新密码"
                    rules={[{ required: true, message: '请再次输入新密码' }]}
                  >
                    <Input.Password />
                  </Form.Item>
                  <Button type="primary" loading={savingPwd} onClick={() => void savePassword()}>
                    修改密码
                  </Button>
                </Form>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
