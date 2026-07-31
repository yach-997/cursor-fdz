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
  Tabs,
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
  fetchInspectorPool,
  enableMyInspector,
} from '../../api/user';
import { fetchSites, addSiteMember, removeSiteMember, fetchSiteMembers } from '../../api/site';
import { useAuthStore } from '../../stores/auth';
import type { UserInfo, SiteItem, UserRole, CommonStatus } from '../../types';

/** 用户管理：管理员→正网格长；正/副网格长权限对齐，设立副网格长与工程师（单一角色） */
export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'super_admin';
  const isSiteManager = currentUser?.role === 'site_manager';

  const [tab, setTab] = useState('list');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<UserRole | undefined>(undefined);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserInfo | null>(null);
  const [form] = Form.useForm();

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<UserInfo | null>(null);
  const [pwdForm] = Form.useForm();

  const [poolLoading, setPoolLoading] = useState(false);
  const [pool, setPool] = useState<UserInfo[]>([]);
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolPage, setPoolPage] = useState(1);
  const [poolKeyword, setPoolKeyword] = useState('');

  const [hireOpen, setHireOpen] = useState(false);
  const [hireUser, setHireUser] = useState<UserInfo | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [managedSites, setManagedSites] = useState<SiteItem[]>([]);
  const [hireSiteId, setHireSiteId] = useState<string>();
  const [memberMap, setMemberMap] = useState<Record<string, string[]>>({});

  const canStaffAsManager = isSiteManager && managedSites.length > 0;
  const canStaffAccounts = isAdmin || canStaffAsManager;

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
    } finally {
      setLoading(false);
    }
  }, [page, keyword, role]);

  const loadPool = useCallback(async () => {
    if (!canStaffAsManager) return;
    setPoolLoading(true);
    try {
      const res = await fetchInspectorPool({
        page: poolPage,
        limit: 10,
        keyword: poolKeyword || undefined,
      });
      setPool(res.list);
      setPoolTotal(res.total);
      setSites(managedSites);
      const map: Record<string, string[]> = {};
      for (const site of managedSites) {
        const members = await fetchSiteMembers(site.id, 'inspector');
        map[site.id] = members.filter((m) => m.status === 'active').map((m) => m.userId);
      }
      setMemberMap(map);
    } finally {
      setPoolLoading(false);
    }
  }, [poolPage, poolKeyword, canStaffAsManager, managedSites]);

  useEffect(() => {
    if (tab === 'list') void loadList();
    else if (tab === 'pool' && canStaffAsManager) void loadPool();
  }, [tab, loadList, loadPool, canStaffAsManager]);

  const roleOptions = useMemo(() => {
    if (isAdmin) {
      return [{ value: 'site_manager', label: '正网格长' }];
    }
    return [
      { value: 'site_manager', label: '副网格长（PC）' },
      { value: 'inspector', label: '工程师（H5）' },
    ];
  }, [isAdmin]);

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
    const list = record.roles?.length ? record.roles : record.role ? [record.role] : [];
    form.setFieldsValue({
      ...record,
      roles: isAdmin ? ['site_manager'] : list,
    });
    setModalOpen(true);
  };

  const submitUser = async () => {
    const values = await form.validateFields();
    const roles: UserRole[] = isAdmin
      ? ['site_manager']
      : values.roles?.length
        ? values.roles
        : [values.role].filter(Boolean);
    if (editing) {
      await updateUser(editing.id, {
        realName: values.realName,
        phone: values.phone,
        roles,
      });
      message.success('用户已更新');
    } else {
      await createUser({
        username: values.username,
        password: values.password,
        realName: values.realName,
        phone: values.phone,
        roles,
      });
      message.success(
        roles.includes('inspector') &&
          (values.username === currentUser?.username || values.phone === currentUser?.phone)
          ? '已为本账号开通工程师身份，可用同一账号登录 H5'
          : '用户已创建',
      );
      if (
        roles.includes('inspector') &&
        (values.username === currentUser?.username || values.phone === currentUser?.phone)
      ) {
        await useAuthStore.getState().fetchMe();
      }
    }
    setModalOpen(false);
    void loadList();
  };

  const onEnableMyInspector = async () => {
    await enableMyInspector();
    await useAuthStore.getState().fetchMe();
    message.success('已开通工程师身份，可用本账号登录 H5 巡检端');
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
    void loadPool();
  };

  const doFire = async (userId: string, siteId: string) => {
    await removeSiteMember(siteId, userId);
    message.success('已解聘');
    void loadPool();
  };

  const listColumns: ColumnsType<UserInfo> = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '姓名', dataIndex: 'realName', width: 100 },
    { title: '手机号', dataIndex: 'phone', width: 130 },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 120,
      render: (_roles: UserRole[] | undefined, r) => {
        const list = r.roles?.length ? r.roles : r.role ? [r.role] : [];
        if (isAdmin) return <Tag>正网格长</Tag>;
        const tags: string[] = [];
        if (list.includes('site_manager')) tags.push('副网格长');
        if (list.includes('inspector')) tags.push('工程师');
        if (!tags.length) tags.push('未知角色');
        return (
          <Space size={[4, 4]} wrap>
            {tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </Space>
        );
      },
    },
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
      width: 260,
      fixed: 'right',
      render: (_, record) =>
        canStaffAccounts ? (
          <Space wrap>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
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
        ) : (
          <Typography.Text type="secondary">只读</Typography.Text>
        ),
    },
  ];

  const poolColumns: ColumnsType<UserInfo> = [
    { title: '姓名', dataIndex: 'realName', width: 100 },
    { title: '手机号', dataIndex: 'phone', width: 130 },
    {
      title: '已加入站点数',
      dataIndex: 'membershipCount',
      width: 120,
      render: (v) => v ?? 0,
    },
    {
      title: '操作',
      width: 280,
      render: (_, record) => {
        const hiredSites = sites.filter((s) => (memberMap[s.id] || []).includes(record.id));
        return (
          <Space wrap>
            <Button type="primary" size="small" onClick={() => openHire(record)}>
              聘用
            </Button>
            {hiredSites.map((s) => (
              <Popconfirm
                key={s.id}
                title={`确认从「${s.name}」解聘？`}
                onConfirm={() => void doFire(record.id, s.id)}
              >
                <Button size="small" danger>
                  解聘·{s.name}
                </Button>
              </Popconfirm>
            ))}
          </Space>
        );
      },
    },
  ];

  const tabItems = [
    { key: 'list', label: '用户列表' },
    ...(canStaffAsManager ? [{ key: 'pool', label: '人才池' }] : []),
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
              ? '正/副网格长权限相同。可设立副网格长/工程师；给自己勾选工程师或点「开通我的工程师身份」后，同一账号可登 H5。'
              : '请先被任命为正网格长或副网格长后，再编制下属账号。'
        }
      />

      {canStaffAsManager && !iAmInspector && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message="本账号尚未开通工程师身份"
          description="开通后可用同一用户名登录 H5 巡检端接单作业。"
          action={
            <Button type="primary" icon={<MobileOutlined />} onClick={() => void onEnableMyInspector()}>
              开通我的工程师身份
            </Button>
          }
        />
      )}

      <Tabs activeKey={tab} onChange={setTab} items={tabItems} />

      {tab === 'list' ? (
        <>
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
            scroll={{ x: 900 }}
            pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
          />
        </>
      ) : (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="搜索人才池"
              allowClear
              onSearch={(v) => {
                setPoolPage(1);
                setPoolKeyword(v);
              }}
              style={{ width: 240 }}
            />
          </Space>
          <Table
            rowKey="id"
            loading={poolLoading}
            columns={poolColumns}
            dataSource={pool}
            pagination={{
              current: poolPage,
              total: poolTotal,
              pageSize: 10,
              onChange: setPoolPage,
            }}
          />
        </>
      )}

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
                rules={[{ required: true, min: 6, message: '至少6位' }]}
              >
                <Input.Password />
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
                ? '正网格长登录 PC；创建后到「站点管理」任命到电站'
                : '可只建工程师，或副网格长兼工程师。给自己开通工程师时，用户名/手机号填本账号即可。'
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
        title={`聘用工程师 - ${hireUser?.realName || ''}`}
        open={hireOpen}
        onCancel={() => setHireOpen(false)}
        onOk={() => void submitHire()}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择所管站点"
          value={hireSiteId}
          onChange={setHireSiteId}
          options={managedSites.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` }))}
        />
      </Modal>
    </div>
  );
}
