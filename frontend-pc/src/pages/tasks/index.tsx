import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  fetchTasks,
  createTask,
  updateTask,
  cancelTask,
  type TaskItem,
  type TaskStatus,
} from '../../api/task';
import { fetchSites, fetchSiteMembers } from '../../api/site';
import { fetchDevices } from '../../api/device';
import type { SiteItem, DeviceItem, DeviceType } from '../../types';
import { DEVICE_TYPE_LABEL } from '../../types';

/** 对外展示的三种任务状态 */
function displayStatus(t: TaskItem): { color: string; text: string } {
  if (t.status === 'pending') return { color: 'default', text: '未开始' };
  if (t.status === 'submitted' || t.status === 'approved') {
    return { color: 'success', text: '已完成' };
  }
  if (t.status === 'archived') return { color: 'default', text: '已归档' };
  // in_progress / rejected → 进行中
  return { color: 'processing', text: '进行中' };
}

const STATUS_GROUP_OPTIONS = [
  { value: 'not_started', label: '未开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
];

const DEVICE_TYPE_OPTIONS = Object.entries(DEVICE_TYPE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/**
 * 任务管理：
 * - 管理员/站长可创建、列表、筛选、编辑、归档
 * - 字段：任务名称、设备序列号、设备类型、所属区域/现场（及指派工程师）
 */
export default function TasksPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [region, setRegion] = useState('');
  const [statusGroup, setStatusGroup] = useState<string>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form] = Form.useForm();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [inspectors, setInspectors] = useState<
    Array<{ userId: string; realName: string; phone: string }>
  >([]);
  const [formDeviceType, setFormDeviceType] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTasks({
        page,
        limit: 10,
        keyword: keyword || undefined,
        region: region || undefined,
        statusGroup: statusGroup || undefined,
        startDate: dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: dateRange?.[1]?.format('YYYY-MM-DD'),
      });
      setData(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, region, statusGroup, dateRange]);

  useEffect(() => {
    fetchSites({ limit: 100, status: 'active' }).then((res) => setSites(res.list));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadDevicesAndMembers = async (sid: string, deviceType?: string) => {
    const [devRes, members] = await Promise.all([
      fetchDevices({
        siteId: sid,
        limit: 200,
        deviceType: (deviceType as DeviceType | undefined) || undefined,
      }),
      fetchSiteMembers(sid, 'inspector'),
    ]);
    setDevices(devRes.list);
    setInspectors(
      members
        .filter((m) => m.status === 'active' && m.user)
        .map((m) => ({
          userId: m.userId,
          realName: m.user!.realName,
          phone: m.user!.phone,
        })),
    );
  };

  const filteredDeviceOptions = useMemo(() => {
    const list = formDeviceType
      ? devices.filter((d) => d.deviceType === formDeviceType)
      : devices;
    return list.map((d) => ({
      value: d.id,
      label: `${d.serialNumber} · ${DEVICE_TYPE_LABEL[d.deviceType] || '未知设备类型'}`,
      serialNumber: d.serialNumber,
      deviceType: d.deviceType,
    }));
  }, [devices, formDeviceType]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormDeviceType(undefined);
    setDevices([]);
    setInspectors([]);
    setFormOpen(true);
  };

  const openEdit = async (record: TaskItem) => {
    setEditing(record);
    setFormDeviceType(record.device?.deviceType);
    await loadDevicesAndMembers(record.siteId, record.device?.deviceType);
    form.setFieldsValue({
      taskName: record.taskName,
      siteId: record.siteId,
      deviceType: record.device?.deviceType,
      deviceId: record.deviceId,
      serialNumber: record.device?.serialNumber,
      inspectorId: record.inspectorId,
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    const values = await form.validateFields();
    const payload = {
      taskName: values.taskName,
      siteId: values.siteId,
      deviceId: values.deviceId,
      serialNumber: values.serialNumber,
      inspectorId: values.inspectorId,
      aiEnabled: true,
    };
    if (editing) {
      await updateTask(editing.id, payload);
      message.success('任务已更新');
    } else {
      await createTask(payload);
      message.success('任务已创建');
    }
    setFormOpen(false);
    load();
  };

  const columns: ColumnsType<TaskItem> = [
    { title: '任务名称', dataIndex: 'taskName', ellipsis: true },
    {
      title: '所属区域/现场',
      width: 200,
      render: (_, r) => {
        const reg = r.site?.region || [r.site?.province, r.site?.city, r.site?.district]
          .filter(Boolean)
          .join('');
        return reg || r.site?.name || '-';
      },
    },
    {
      title: '设备序列号',
      width: 140,
      render: (_, r) => r.device?.serialNumber || '-',
    },
    {
      title: '设备类型',
      width: 120,
      render: (_, r) =>
        r.device
          ? DEVICE_TYPE_LABEL[r.device.deviceType as keyof typeof DEVICE_TYPE_LABEL] ||
            '未知设备类型'
          : '-',
    },
    {
      title: '工程师',
      width: 100,
      render: (_, r) => r.inspector?.realName || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_: TaskStatus, r) => {
        const s = displayStatus(r);
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          {record.status === 'pending' && (
            <Button type="link" onClick={() => void openEdit(record)}>
              编辑
            </Button>
          )}
          {['pending', 'in_progress', 'rejected', 'approved'].includes(record.status) && (
            <Popconfirm
              title="确认归档该任务？归档后不再出现在常规列表中。"
              onConfirm={async () => {
                await cancelTask(record.id);
                message.success('已归档');
                load();
              }}
            >
              <Button type="link">归档</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          allowClear
          placeholder="任务名称"
          style={{ width: 180 }}
          onSearch={(v) => {
            setPage(1);
            setKeyword(v.trim());
          }}
        />
        <Input
          allowClear
          placeholder="区域（省/市/现场）"
          style={{ width: 180 }}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          onPressEnter={() => {
            setPage(1);
            load();
          }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          value={statusGroup}
          onChange={(v) => {
            setPage(1);
            setStatusGroup(v);
          }}
          options={STATUS_GROUP_OPTIONS}
        />
        <DatePicker.RangePicker
          value={dateRange}
          onChange={(v) => {
            setPage(1);
            setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null);
          }}
          placeholder={['开始日期', '结束日期']}
        />
        <Button
          onClick={() => {
            setPage(1);
            load();
          }}
        >
          查询
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          创建任务
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: 1100 }}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
      />

      <Modal
        title={editing ? '编辑巡检任务' : '创建巡检任务'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => void submitForm()}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="taskName"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="如：组串逆变器现场巡检" />
          </Form.Item>
          <Form.Item
            name="siteId"
            label="所属区域/现场"
            rules={[{ required: true, message: '请选择现场' }]}
          >
            <Select
              options={sites.map((s) => ({
                value: s.id,
                label: `${s.name}（${s.province || ''}${s.city || ''}${s.district || ''}）`,
              }))}
              onChange={async (sid) => {
                form.setFieldsValue({
                  deviceId: undefined,
                  serialNumber: undefined,
                  inspectorId: undefined,
                  deviceType: undefined,
                });
                setFormDeviceType(undefined);
                if (sid) await loadDevicesAndMembers(sid);
              }}
            />
          </Form.Item>
          <Form.Item
            name="deviceType"
            label="设备类型"
            rules={[{ required: true, message: '请选择设备类型' }]}
          >
            <Select
              options={DEVICE_TYPE_OPTIONS}
              placeholder="先选类型再选序列号"
              onChange={async (dt) => {
                setFormDeviceType(dt);
                form.setFieldsValue({ deviceId: undefined, serialNumber: undefined });
                const sid = form.getFieldValue('siteId');
                if (sid) await loadDevicesAndMembers(sid, dt);
              }}
            />
          </Form.Item>
          <Form.Item
            name="deviceId"
            label="关联设备序列号"
            rules={[{ required: true, message: '请选择设备序列号' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="按序列号搜索"
              options={filteredDeviceOptions}
              onChange={(id) => {
                const d = devices.find((x) => x.id === id);
                form.setFieldsValue({
                  serialNumber: d?.serialNumber,
                  deviceType: d?.deviceType,
                });
                if (d?.deviceType) setFormDeviceType(d.deviceType);
              }}
            />
          </Form.Item>
          <Form.Item name="serialNumber" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="inspectorId"
            label="工程师"
            rules={[{ required: true, message: '请选择工程师' }]}
          >
            <Select
              options={inspectors.map((i) => ({
                value: i.userId,
                label: `${i.realName}（${i.phone}）`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
