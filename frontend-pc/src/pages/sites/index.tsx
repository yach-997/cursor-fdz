import { useCallback, useEffect, useState } from 'react';
import {
  Button,
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
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserSwitchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchSites,
  createSite,
  updateSite,
  deleteSite,
  appointManager,
  appointDeputy,
  removeDeputy,
  fetchSiteMembers,
  addSiteMember,
  removeSiteMember,
  type SiteMemberItem,
} from '../../api/site';
import { fetchUsers } from '../../api/user';
import type { SiteItem, UserInfo } from '../../types';
import SiteFormModal from './SiteFormModal';
import { composeFullAddress } from '../../utils/addressParse';

/** 站点管理：正站长 / 多副站长 / 多巡检员（巡检员可跨站） */
export default function SitesPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SiteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState<string | undefined>();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SiteItem | null>(null);
  const [form] = Form.useForm();

  const [appointOpen, setAppointOpen] = useState(false);
  const [appointSite, setAppointSite] = useState<SiteItem | null>(null);
  const [managers, setManagers] = useState<UserInfo[]>([]);
  const [managerId, setManagerId] = useState<string>();

  const [staffOpen, setStaffOpen] = useState(false);
  const [staffSite, setStaffSite] = useState<SiteItem | null>(null);
  const [deputies, setDeputies] = useState<SiteMemberItem[]>([]);
  const [inspectors, setInspectors] = useState<SiteMemberItem[]>([]);
  const [staffCandidates, setStaffCandidates] = useState<UserInfo[]>([]);
  const [pickDeputyId, setPickDeputyId] = useState<string>();
  const [pickInspectorId, setPickInspectorId] = useState<string>();
  const [staffLoading, setStaffLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSites({
        page,
        limit: 10,
        keyword: keyword || undefined,
        province: province || undefined,
        city: city || undefined,
        status,
      });
      setData(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, province, city, status]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' });
    setModalOpen(true);
  };

  const openEdit = (record: SiteItem) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      fullAddress: composeFullAddress(record),
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      if (values.latitude == null || values.longitude == null) {
        message.warning('请先点击「现场定位」或「地址解析」确定站点位置');
        return;
      }
      const payload = {
        ...values,
        latitude: Number(values.latitude),
        longitude: Number(values.longitude),
      };
      delete payload.fullAddress;
      if (editing) {
        await updateSite(editing.id, payload);
        message.success('站点已更新');
      } else {
        await createSite(payload);
        message.success('站点已创建');
      }
      setModalOpen(false);
      load();
    } catch {
      /* 校验失败 */
    }
  };

  const onDelete = async (id: string) => {
    await deleteSite(id);
    message.success('站点已删除');
    load();
  };

  const openAppoint = async (record: SiteItem) => {
    setAppointSite(record);
    setManagerId(record.managerId || undefined);
    const res = await fetchUsers({ role: 'site_manager', status: 'active', limit: 100 });
    const insp = await fetchUsers({ role: 'inspector', status: 'active', limit: 100 });
    setManagers([...res.list, ...insp.list]);
    setAppointOpen(true);
  };

  const submitAppoint = async () => {
    if (!appointSite || !managerId) {
      message.warning('请选择正站长');
      return;
    }
    await appointManager(appointSite.id, managerId);
    message.success('已任命正站长');
    setAppointOpen(false);
    load();
  };

  const loadStaff = async (site: SiteItem) => {
    setStaffLoading(true);
    try {
      const [dep, insp, allUsers] = await Promise.all([
        fetchSiteMembers(site.id, 'deputy_manager'),
        fetchSiteMembers(site.id, 'inspector'),
        // 拉全量启用用户，多角色账号两边都能选到
        fetchUsers({ status: 'active', limit: 100 }),
      ]);
      setDeputies(dep);
      setInspectors(insp);
      setStaffCandidates(
        allUsers.list.filter((u) => !(u.roles?.length ? u.roles : [u.role]).includes('super_admin')),
      );
    } finally {
      setStaffLoading(false);
    }
  };

  const openStaff = async (record: SiteItem) => {
    setStaffSite(record);
    setPickDeputyId(undefined);
    setPickInspectorId(undefined);
    setStaffOpen(true);
    await loadStaff(record);
  };

  const onAddDeputy = async () => {
    if (!staffSite || !pickDeputyId) {
      message.warning('请选择副站长');
      return;
    }
    await appointDeputy(staffSite.id, pickDeputyId);
    message.success('已添加副站长');
    setPickDeputyId(undefined);
    await loadStaff(staffSite);
  };

  const onAddInspector = async () => {
    if (!staffSite || !pickInspectorId) {
      message.warning('请选择巡检员');
      return;
    }
    await addSiteMember(staffSite.id, pickInspectorId);
    message.success('已聘用巡检员（该员仍可同时服务于其他站点）');
    setPickInspectorId(undefined);
    await loadStaff(staffSite);
  };

  const regionHint = [province && `省「${province}」`, city && `市「${city}」`]
    .filter(Boolean)
    .join('、');

  const hasRole = (u: UserInfo, role: string) =>
    (u.roles?.length ? u.roles : [u.role]).includes(role as UserInfo['role']);

  const deputyOptions = staffCandidates
    .filter((u) => hasRole(u, 'site_manager'))
    .filter((u) => u.id !== staffSite?.managerId)
    .filter((u) => !deputies.some((d) => d.userId === u.id))
    .map((u) => ({
      value: u.id,
      label: `${u.realName}（${u.username}）`,
    }));

  const inspectorOptions = staffCandidates
    .filter((u) => hasRole(u, 'inspector'))
    .filter((u) => !inspectors.some((d) => d.userId === u.id))
    .map((u) => ({
      value: u.id,
      label: `${u.realName}（${u.username}）`,
    }));

  const columns: ColumnsType<SiteItem> = [
    { title: '站点名称', dataIndex: 'name', width: 140 },
    { title: '编码', dataIndex: 'code', width: 100 },
    {
      title: '地区',
      render: (_, r) => `${r.province}${r.city}${r.district}`,
      ellipsis: true,
    },
    { title: '地址', dataIndex: 'address', ellipsis: true },
    {
      title: '正站长',
      dataIndex: ['manager', 'realName'],
      width: 100,
      render: (v) => v || '-',
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
      width: 300,
      fixed: 'right',
      render: (_, record) => (
        <Space wrap>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="link" icon={<UserSwitchOutlined />} onClick={() => openAppoint(record)}>
            正站长
          </Button>
          <Button type="link" icon={<TeamOutlined />} onClick={() => void openStaff(record)}>
            人员
          </Button>
          <Popconfirm title="确认删除该站点？有设备时将失败" onConfirm={() => onDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          placeholder="搜索名称/编码/地区"
          allowClear
          onSearch={(v) => {
            setPage(1);
            setKeyword(v);
          }}
          style={{ width: 220 }}
        />
        <Input.Search
          placeholder="省份，如：四川"
          allowClear
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          onSearch={(v) => {
            setPage(1);
            setProvince(v.trim());
          }}
          enterButton="按省查"
          style={{ width: 240 }}
        />
        <Input.Search
          placeholder="城市，如：自贡"
          allowClear
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onSearch={(v) => {
            setPage(1);
            setCity(v.trim());
          }}
          enterButton="按市查"
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          value={status}
          onChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
          options={[
            { value: 'active', label: '启用' },
            { value: 'inactive', label: '停用' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增站点
        </Button>
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {regionHint
          ? `当前筛选：${regionHint} → 共 ${total} 个电站`
          : `一站一名正站长、多名副站长；正/副站长可聘多名巡检员；巡检员可跨多个站点`}
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          total,
          pageSize: 10,
          showTotal: (t) => `共 ${t} 个电站`,
          onChange: setPage,
        }}
      />

      <SiteFormModal
        open={modalOpen}
        editing={editing}
        form={form}
        onCancel={() => setModalOpen(false)}
        onSubmit={() => void submit()}
      />

      <Modal
        title={`任命正站长 - ${appointSite?.name || ''}`}
        open={appointOpen}
        onCancel={() => setAppointOpen(false)}
        onOk={() => void submitAppoint()}
      >
        <Typography.Paragraph type="secondary">
          每站仅一名正站长。可从站长账号或巡检员中选择（选巡检员将提升为站长角色）。
        </Typography.Paragraph>
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="选择正站长"
          value={managerId}
          onChange={setManagerId}
          optionFilterProp="label"
          options={managers.map((m) => ({
            value: m.id,
            label: `${m.realName}（${m.username} / ${m.role === 'inspector' ? '巡检员' : '站长'}）`,
          }))}
        />
      </Modal>

      <Modal
        title={`站点人员 - ${staffSite?.name || ''}`}
        open={staffOpen}
        onCancel={() => setStaffOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          正站长：{staffSite?.manager?.realName || '未任命'}。副站长须为「站长」角色账号；巡检员账号可同时加入多个站点。
        </Typography.Paragraph>
        <Tabs
          items={[
            {
              key: 'deputy',
              label: `副站长（${deputies.length}）`,
              children: (
                <div>
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Select
                      showSearch
                      style={{ width: 280 }}
                      placeholder="选择站长账号"
                      value={pickDeputyId}
                      onChange={setPickDeputyId}
                      optionFilterProp="label"
                      options={deputyOptions}
                    />
                    <Button type="primary" onClick={() => void onAddDeputy()}>
                      添加副站长
                    </Button>
                  </Space>
                  <Table
                    rowKey="id"
                    size="small"
                    loading={staffLoading}
                    pagination={false}
                    dataSource={deputies}
                    columns={[
                      { title: '姓名', dataIndex: ['user', 'realName'] },
                      { title: '用户名', dataIndex: ['user', 'username'] },
                      {
                        title: '操作',
                        width: 100,
                        render: (_, r) => (
                          <Popconfirm
                            title="确认移除该副站长？"
                            onConfirm={async () => {
                              if (!staffSite) return;
                              await removeDeputy(staffSite.id, r.userId);
                              message.success('已移除');
                              await loadStaff(staffSite);
                            }}
                          >
                            <Button type="link" danger>
                              移除
                            </Button>
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'inspector',
              label: `巡检员（${inspectors.length}）`,
              children: (
                <div>
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Select
                      showSearch
                      style={{ width: 280 }}
                      placeholder="选择巡检员账号"
                      value={pickInspectorId}
                      onChange={setPickInspectorId}
                      optionFilterProp="label"
                      options={inspectorOptions}
                    />
                    <Button type="primary" onClick={() => void onAddInspector()}>
                      聘用巡检员
                    </Button>
                  </Space>
                  <Table
                    rowKey="id"
                    size="small"
                    loading={staffLoading}
                    pagination={false}
                    dataSource={inspectors}
                    columns={[
                      { title: '姓名', dataIndex: ['user', 'realName'] },
                      { title: '用户名', dataIndex: ['user', 'username'] },
                      {
                        title: '操作',
                        width: 100,
                        render: (_, r) => (
                          <Popconfirm
                            title="确认解聘？不影响其在其他站点的任职"
                            onConfirm={async () => {
                              if (!staffSite) return;
                              await removeSiteMember(staffSite.id, r.userId);
                              message.success('已解聘');
                              await loadStaff(staffSite);
                            }}
                          >
                            <Button type="link" danger>
                              解聘
                            </Button>
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}
