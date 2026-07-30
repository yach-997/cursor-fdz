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
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchUsers,
  createUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  fetchInspectorPool,
} from '../../api/user';
import { fetchSites, addSiteMember, removeSiteMember, fetchSiteMembers } from '../../api/site';
import { useAuthStore } from '../../stores/auth';
import type { UserInfo, SiteItem, UserRole, CommonStatus } from '../../types';
import { ROLE_LABEL } from '../../types';

/** 用户管理：管理员只管网格长；正网格长管副网格长与工程师 */
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
  const [primarySites, setPrimarySites] = useState<SiteItem[]>([]);
  const [hireSiteId, setHireSiteId] = useState<string>();
  const [memberMap, setMemberMap] = useState<Record<string, string[]>>({});

  const isPrimaryManager = primarySites.length > 0;
  const canStaffAccounts = isAdmin || isPrimaryManager;

  const loadPrimarySites = useCallback(async () => {
    if (!isSiteManager || !currentUser?.id) {
      setPrimarySites([]);
      return;
    }
    const siteRes = await fetchSites({ limit: 100, status: 'active' });
    setPrimarySites(siteRes.list.filter((s) => s.managerId === currentUser.id));
  }, [isSiteManager, currentUser?.id]);

  useEffect(() => {
    void loadPrimarySites();
  }, [loadPrimarySites]);

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
    if (!isPrimaryManager) return;
    setPoolLoading(true);
    try {
      const res = await fetchInspectorPool({
        page: poolPage,
        limit: 10,
        keyword: poolKeyword || undefined,
      });
      setPool(res.list);
      setPoolTotal(res.total);

      setSites(primarySites);
      const map: Record<string, string[]> = {};
      for (const site of primarySites) {
        const members = await fetchSiteMembers(site.id, 'inspector');
        map[site.id] = members.filter((m) => m.status === 'active').map((m) => m.userId);
      }
      setMemberMap(map);
    } finally {
      setPoolLoading(false);
    }
  }, [poolPage, poolKeyword, isPrimaryManager, primarySites]);

  useEffect(() => {
    if (tab === 'list') void loadList();
    else if (tab === 'pool' && isPrimaryManager) void loadPool();
  }, [tab, loadList, loadPool, isPrimaryManager]);

  const roleOptions = useMemo(() => {
    if (isAdmin) {
      return [{ value: 'site_manager', label: '网格长' }];
    }
    return [
      { value: 'site_manager', label: '网格长（可任副网格长）' },
      { value: 'inspector', label: '工程师' },
    ];
  }, [isAdmin]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ roles: isAdmin ? ['site_manager'] : ['inspector'] });
    setModalOpen(true);
  };

  const openEdit = (record: UserInfo) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      roles: record.roles?.length ? record.roles : [record.role],
    });
    setModalOpen(true);
  };

  const submitUser = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      roles: values.roles?.length ? values.roles : [values.role].filter(Boolean),
    };
    delete payload.role;
    if (editing) {
      const updatePayload = { ...payload };
      delete updatePayload.username;
      delete updatePayload.password;
      await updateUser(editing.id, updatePayload);
      message.success('用户已更新');
    } else {
      await createUser(payload);
      message.success('用户已创建');
    }
    setModalOpen(false);
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
    setHireSiteId(primarySites[0]?.id);
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
      width: 180,
      render: (roles: UserRole[] | undefined, r) => {
        const list = roles?.length ? roles : r.role ? [r.role] : [];
        return (
          <Space size={[4, 4]} wrap>
            {list.map((v) => (
              <Tag key={v}>{ROLE_LABEL[v] || '未知角色'}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '归属区域',
      dataIndex: 'region',
      width: 100,
      render: (v) => (v === 'yunnan' ? '云南' : v === 'south_china' ? '华南' : '-'),
    },
    { title: '归属单位', dataIndex: 'orgUnit', width: 140, render: (v) => v || '-' },
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
      title: '归属区域',
      dataIndex: 'region',
      render: (v) => (v === 'yunnan' ? '云南' : v === 'south_china' ? '华南' : '-'),
    },
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
    ...(isPrimaryManager ? [{ key: 'pool', label: '人才池' }] : []),
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          isAdmin
            ? '管理员只创建网格长账号，并在「站点管理」中任命为正网格长。工程师由正网格长创建与聘用。'
            : isPrimaryManager
              ? '正网格长可创建副网格长（网格长角色）与工程师，并在本站「人员」或人才池中任命/聘用。'
              : '副网格长可查看本区域人员，账号编制由正网格长管理。'
        }
      />

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
                  ? [
                      { value: 'site_manager', label: '网格长' },
                      { value: 'super_admin', label: '超级管理员' },
                    ]
                  : [
                      { value: 'site_manager', label: '网格长' },
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
            label="角色（可多选）"
            rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个角色' }]}
            extra={
              isAdmin
                ? '管理员仅创建网格长账号'
                : '可同时勾选网格长和工程师：电脑登录管理端，手机登录巡检端'
            }
          >
            <Checkbox.Group options={roleOptions} />
          </Form.Item>
          <Form.Item name="region" label="归属区域">
            <Select
              allowClear
              placeholder="选填，仅作档案展示，不限制派单与跨站管人"
              options={[
                { value: 'south_china', label: '华南' },
                { value: 'yunnan', label: '云南' },
              ]}
            />
          </Form.Item>
          <Form.Item name="orgUnit" label="归属单位">
            <Input placeholder="选填，如：华南运维中心" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
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
          placeholder="选择本站（正网格长站点）"
          value={hireSiteId}
          onChange={setHireSiteId}
          options={primarySites.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` }))}
        />
      </Modal>
    </div>
  );
}
