import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, MobileOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchUsers,
  createUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  enableMyInspector,
} from '../../api/user';
import { fetchSites, addSiteMember, removeSiteMember, fetchSiteMembers } from '../../api/site';
import { useAuthStore } from '../../stores/auth';
import type { UserInfo, SiteItem, UserRole, CommonStatus } from '../../types';

function userRolesOf(record: UserInfo): UserRole[] {
  return record.roles?.length ? record.roles : record.role ? [record.role] : [];
}

/** 用户管理：管理员→正网格长；正/副网格长在列表内设立账号并聘用工程师到网格 */
export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'super_admin';
  const isSiteManager = currentUser?.role === 'site_manager';

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<UserRole | undefined>(undefined);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserInfo | null>(null);
  const [form] = Form.useForm();
  const watchUsername = Form.useWatch('username', form);
  const watchPhone = Form.useWatch('phone', form);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<UserInfo | null>(null);
  const [pwdForm] = Form.useForm();

  const [hireOpen, setHireOpen] = useState(false);
  const [hireUser, setHireUser] = useState<UserInfo | null>(null);
  const [managedSites, setManagedSites] = useState<SiteItem[]>([]);
  const [hireSiteId, setHireSiteId] = useState<string>();
  const [memberMap, setMemberMap] = useState<Record<string, string[]>>({});

  const isPrimaryManager = managedSites.some((s) => s.managerId === currentUser?.id);
  const canStaffAsManager = isSiteManager && managedSites.length > 0;
  const canStaffAccounts = isAdmin || canStaffAsManager;

  const creatingForSelf =
    !editing &&
    isSiteManager &&
    Boolean(currentUser) &&
    ((watchUsername && watchUsername === currentUser?.username) ||
      (watchPhone && watchPhone === currentUser?.phone));

  const editingSelf = Boolean(editing && editing.id === currentUser?.id);

  const roleOptions = useMemo(() => {
    if (isAdmin) {
      return [{ value: 'site_manager', label: '正网格长' }];
    }
    if (creatingForSelf || editingSelf) {
      return [
        {
          value: 'site_manager',
          label: isPrimaryManager ? '正网格长（本账号）' : '网格长（本账号）',
          disabled: true,
        },
        { value: 'inspector', label: '工程师（H5）' },
      ];
    }
    return [
      { value: 'site_manager', label: '副网格长（PC）' },
      { value: 'inspector', label: '工程师（H5）' },
    ];
  }, [isAdmin, creatingForSelf, editingSelf, isPrimaryManager]);

  useEffect(() => {
    if (creatingForSelf) {
      form.setFieldsValue({ roles: ['site_manager', 'inspector'] });
    }
  }, [creatingForSelf, form]);

  const loadManagedSites = useCallback(async () => {
    if (!isSiteManager || !currentUser?.id) {
      setManagedSites([]);
      return;
    }
    const siteRes = await fetchSites({ limit: 100, status: 'active' });
    setManagedSites(siteRes.list);
  }, [isSiteManager, currentUser?.id]);

  useEffect(() => {
    void loadManagedSites();
  }, [loadManagedSites]);

  const loadMemberMap = useCallback(async (sites: SiteItem[]) => {
    if (!sites.length) {
      setMemberMap({});
      return;
    }
    const map: Record<string, string[]> = {};
    await Promise.all(
      sites.map(async (site) => {
        const members = await fetchSiteMembers(site.id, 'inspector');
        map[site.id] = members.filter((m) => m.status === 'active').map((m) => m.userId);
      }),
    );
    setMemberMap(map);
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchUsers({
        page,
        limit: 10,
        keyword: keyword || undefined,
        role,
      });
      setData(res.list);
      setTotal(res.total);
      if (canStaffAsManager) {
        await loadMemberMap(managedSites);
      } else {
        setMemberMap({});
      }
    } finally {
      setLoading(false);
    }
  }, [page, keyword, role, canStaffAsManager, managedSites, loadMemberMap]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const iAmInspector = Boolean(
    currentUser?.roles?.includes('inspector') || currentUser?.role === 'inspector',
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ roles: isAdmin ? ['site_manager'] : ['inspector'] });
    setModalOpen(true);
  };

  const openEdit = (record: UserInfo) => {
    setEditing(record);
    const list = userRolesOf(record);
    const isSelf = record.id === currentUser?.id;
    form.setFieldsValue({
      ...record,
      roles: isAdmin
        ? ['site_manager']
        : isSelf
          ? list.includes('inspector')
            ? ['site_manager', 'inspector']
            : ['site_manager']
          : list,
    });
    setModalOpen(true);
  };

  const submitUser = async () => {
    const values = await form.validateFields();
    const isSelfCreate =
      !editing &&
      (values.username === currentUser?.username || values.phone === currentUser?.phone);

    if (!editing && isSelfCreate) {
      if (!values.roles?.includes('inspector')) {
        message.error('给自己开通时请勾选工程师');
        return;
      }
      await enableMyInspector();
      await useAuthStore.getState().fetchMe();
      message.success('已为本账号开通工程师身份，请退出后用同一账号登录 H5');
      setModalOpen(false);
      void loadList();
      return;
    }

    if (editing && editing.id === currentUser?.id && !isAdmin) {
      const nextRoles: UserRole[] = ['site_manager'];
      if (values.roles?.includes('inspector')) nextRoles.push('inspector');
      await updateUser(editing.id, {
        realName: values.realName,
        employeeNo: values.employeeNo,
        phone: values.phone,
        roles: nextRoles,
      });
      await useAuthStore.getState().fetchMe();
      message.success(
        nextRoles.includes('inspector')
          ? '已更新；工程师身份已保留/开通，请用同一账号重新登录 H5'
          : '已更新（未勾选工程师则无法登录 H5）',
      );
      setModalOpen(false);
      void loadList();
      return;
    }

    const roles: UserRole[] = isAdmin
      ? ['site_manager']
      : values.roles?.length
        ? values.roles
        : [values.role].filter(Boolean);
    if (editing) {
      await updateUser(editing.id, {
        realName: values.realName,
        employeeNo: values.employeeNo,
        phone: values.phone,
        roles,
      });
      message.success('用户已更新');
      if (editing.id === currentUser?.id) await useAuthStore.getState().fetchMe();
    } else {
      await createUser({
        username: values.username,
        password: values.password,
        realName: values.realName,
        employeeNo: values.employeeNo,
        phone: values.phone,
        roles,
      });
      message.success('用户已创建');
    }
    setModalOpen(false);
    void loadList();
  };

  const onEnableMyInspector = async () => {
    await enableMyInspector();
    await useAuthStore.getState().fetchMe();
    message.success('已开通工程师身份，请退出后用同一账号登录 H5 作业端');
    void loadList();
  };

  const toggleStatus = async (record: UserInfo) => {
    const next: CommonStatus = record.status === 'active' ? 'inactive' : 'active';
    await updateUserStatus(record.id, next);
    message.success(next === 'active' ? '已启用' : '已停用');
    void loadList();
  };

  const submitPwd = async () => {
    const values = await pwdForm.validateFields();
    if (!pwdUser) return;
    await resetUserPassword(pwdUser.id, values.newPassword);
    message.success('密码已重置');
    setPwdOpen(false);
  };

  const openHire = (user: UserInfo) => {
    setHireUser(user);
    setHireSiteId(managedSites[0]?.id);
    setHireOpen(true);
  };

  const submitHire = async () => {
    if (!hireUser || !hireSiteId) return;
    await addSiteMember(hireSiteId, hireUser.id);
    message.success('聘用成功');
    setHireOpen(false);
    void loadList();
  };

  const doFire = async (userId: string, siteId: string) => {
    await removeSiteMember(siteId, userId);
    message.success('已解聘');
    void loadList();
  };

  const listColumns: ColumnsType<UserInfo> = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '工号', dataIndex: 'employeeNo', width: 110, render: (v) => v || '-' },
    { title: '姓名', dataIndex: 'realName', width: 100 },
    { title: '手机号', dataIndex: 'phone', width: 130 },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 140,
      render: (_roles: UserRole[] | undefined, r) => {
        const list = userRolesOf(r);
        if (isAdmin) return <Tag>正网格长</Tag>;
        const isSelf = r.id === currentUser?.id;
        const tags: string[] = [];
        if (list.includes('site_manager')) {
          tags.push(isSelf && isPrimaryManager ? '正网格长' : '副网格长');
        }
        if (list.includes('inspector')) tags.push('工程师');
        if (!tags.length) tags.push('未知角色');
        return (
          <Space size={[4, 4]} wrap>
            {tags.map((t) => (
              <Tag key={t} color={t === '工程师' ? 'blue' : 'green'}>
                {t}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    ...(canStaffAsManager
      ? ([
          {
            title: '已聘网格',
            width: 160,
            render: (_: unknown, record: UserInfo) => {
              if (!userRolesOf(record).includes('inspector')) {
                return <Typography.Text type="secondary">—</Typography.Text>;
              }
              const hired = managedSites.filter((s) => (memberMap[s.id] || []).includes(record.id));
              if (!hired.length) {
                return <Typography.Text type="secondary">未聘用</Typography.Text>;
              }
              return (
                <Space size={[4, 4]} wrap>
                  {hired.map((s) => (
                    <Tag key={s.id}>{s.name}</Tag>
                  ))}
                </Space>
              );
            },
          },
        ] as ColumnsType<UserInfo>)
      : []),
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => (
        <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '启用' : '停用'}</Tag>
      ),
    },
    {
      title: '操作',
      width: canStaffAsManager ? 360 : 260,
      fixed: 'right',
      render: (_, record) => {
        if (!canStaffAccounts) {
          return <Typography.Text type="secondary">只读</Typography.Text>;
        }
        const roles = userRolesOf(record);
        const canHire = canStaffAsManager && roles.includes('inspector');
        const hiredSites = canHire
          ? managedSites.filter((s) => (memberMap[s.id] || []).includes(record.id))
          : [];
        return (
          <Space wrap>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
            {canHire && (
              <Button type="link" onClick={() => openHire(record)}>
                聘用到网格
              </Button>
            )}
            {hiredSites.map((s) => (
              <Popconfirm
                key={s.id}
                title={`确认从「${s.name}」解聘？`}
                onConfirm={() => void doFire(record.id, s.id)}
              >
                <Button type="link" danger>
                  解聘·{s.name}
                </Button>
              </Popconfirm>
            ))}
            <Button
              type="link"
              onClick={() => {
                setPwdUser(record);
                pwdForm.resetFields();
                setPwdOpen(true);
              }}
            >
              重置密码
            </Button>
            <Popconfirm
              title={`确认${record.status === 'active' ? '停用' : '启用'}该用户？`}
              onConfirm={() => void toggleStatus(record)}
            >
              <Button type="link" danger={record.status === 'active'}>
                {record.status === 'active' ? '停用' : '启用'}
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          isAdmin
            ? '管理员只设立正网格长（PC）。工程师须由正/副网格长设立；正/副网格长也可为自己开通工程师身份后登录 H5。'
            : canStaffAsManager
              ? '在用户列表设立副网格长/工程师；工程师可直接「聘用到网格」。正网格长不能给自己设副网格长，可开通工程师后同一账号登 H5。'
              : '请先被任命为正网格长或副网格长后，再编制下属账号。'
        }
      />

      {canStaffAsManager && !iAmInspector && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message="本账号尚未开通工程师身份"
          description="开通后可用同一用户名登录 H5 作业端接单作业。"
          action={
            <Button type="primary" icon={<MobileOutlined />} onClick={() => void onEnableMyInspector()}>
              开通我的工程师身份
            </Button>
          }
        />
      )}

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索用户名/姓名/手机"
          allowClear
          onSearch={(v) => {
            setPage(1);
            setKeyword(v);
          }}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder="角色"
          style={{ width: 140 }}
          value={role}
          onChange={(v) => {
            setPage(1);
            setRole(v);
          }}
          options={
            isAdmin
              ? [{ value: 'site_manager', label: '正网格长' }]
              : [
                  { value: 'site_manager', label: '副网格长' },
                  { value: 'inspector', label: '工程师' },
                ]
          }
        />
        {canStaffAccounts && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增用户
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={listColumns}
        dataSource={data}
        scroll={{ x: canStaffAsManager ? 1100 : 900 }}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
      />

      <Modal
        title={editing ? '编辑用户' : '新增用户'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submitUser()}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <>
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={
                  creatingForSelf
                    ? []
                    : [{ required: true, min: 6, message: '至少6位' }]
                }
              >
                <Input.Password
                  placeholder={creatingForSelf ? '给自己开通工程师时无需填写' : undefined}
                  disabled={creatingForSelf}
                />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="realName"
            label="真实姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="employeeNo"
            label="工号"
            rules={
              creatingForSelf
                ? []
                : [
                    { required: true, message: '请输入工号' },
                    { min: 2, max: 32, message: '工号 2-32 位' },
                  ]
            }
          >
            <Input
              placeholder={creatingForSelf ? '给自己开通工程师时无需填写' : '员工工号，不可重复'}
              disabled={creatingForSelf}
            />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1\d{10}$/, message: '手机号格式不正确' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="roles"
            label={isAdmin ? '角色' : '角色（可多选）'}
            rules={[{ required: true, type: 'array', min: 1, message: '请选择角色' }]}
            extra={
              isAdmin
                ? '正网格长登录 PC；创建后到「网格管理」任命到电站'
                : creatingForSelf || editingSelf
                  ? '本账号只能开通/取消工程师，不能设为副网格长（与正网格长冲突）。开通后请重新登录 H5。'
                  : '可设立副网格长或工程师。创建工程师后，在列表中点「聘用到网格」即可安排上岗。'
            }
          >
            <Checkbox.Group options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码 - ${pwdUser?.realName || ''}`}
        open={pwdOpen}
        onCancel={() => setPwdOpen(false)}
        onOk={() => void submitPwd()}
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true, min: 6, message: '至少6位' }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`聘用到网格 - ${hireUser?.realName || ''}`}
        open={hireOpen}
        onCancel={() => setHireOpen(false)}
        onOk={() => void submitHire()}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择所管网格"
          value={hireSiteId}
          onChange={setHireSiteId}
          options={managedSites.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` }))}
        />
      </Modal>
    </div>
  );
}
