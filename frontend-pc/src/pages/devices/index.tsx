import { useCallback, useEffect, useState } from 'react';
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
  Upload,
  message,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  HistoryOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import {
  fetchDevices,
  createDevice,
  updateDevice,
  deleteDevice,
  batchImportDevices,
  fetchDeviceHistory,
} from '../../api/device';
import { fetchSites } from '../../api/site';
import type { DeviceItem, SiteItem, DeviceType } from '../../types';
import { DEVICE_TYPE_LABEL } from '../../types';

/** 设备管理：表格 + 站点筛选 + 批量导入 Excel + 历史 */
export default function DevicesPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [siteId, setSiteId] = useState<string>();
  const [deviceType, setDeviceType] = useState<DeviceType>();
  const [serialNumber, setSerialNumber] = useState('');
  const [sites, setSites] = useState<SiteItem[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceItem | null>(null);
  const [form] = Form.useForm();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<{
    tasks: Array<Record<string, unknown>>;
    records: Array<Record<string, unknown>>;
  } | null>(null);

  const loadSites = useCallback(async () => {
    const res = await fetchSites({ limit: 100, status: 'active' });
    setSites(res.list);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDevices({
        page,
        limit: 10,
        siteId,
        deviceType,
        serialNumber: serialNumber || undefined,
      });
      setData(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, siteId, deviceType, serialNumber]);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    if (siteId) form.setFieldsValue({ siteId });
    setModalOpen(true);
  };

  const openEdit = (record: DeviceItem) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      installDate: record.installDate ? dayjs(record.installDate) : undefined,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      installDate: values.installDate
        ? dayjs(values.installDate).format('YYYY-MM-DD')
        : undefined,
    };
    if (editing) {
      await updateDevice(editing.id, payload);
      message.success('设备已更新');
    } else {
      await createDevice(payload);
      message.success('设备已创建');
    }
    setModalOpen(false);
    load();
  };

  const onDelete = async (id: string) => {
    await deleteDevice(id);
    message.success('设备已删除');
    load();
  };

  const onImport = async (file: File) => {
    const res = await batchImportDevices(file);
    message.success(`导入完成：成功 ${res.successCount}，失败 ${res.failCount}`);
    if (res.failed?.length) {
      Modal.info({
        title: '失败明细',
        content: (
          <div style={{ maxHeight: 240, overflow: 'auto' }}>
            {res.failed.map((f) => (
              <div key={f.row}>
                第 {f.row} 行：{f.reason}
              </div>
            ))}
          </div>
        ),
      });
    }
    load();
    return false;
  };

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['site_code', 'serial_number', 'device_type', 'model', 'manufacturer', 'install_date'],
      ['SITE001', 'SN20260001', 'string_inverter', 'SG110CX', '阳光电源', '2026-01-01'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'devices');
    XLSX.writeFile(wb, '设备导入模板.xlsx');
  };

  const openHistory = async (id: string) => {
    const res = (await fetchDeviceHistory(id)) as {
      tasks: Array<Record<string, unknown>>;
      records: Array<Record<string, unknown>>;
    };
    setHistoryData(res);
    setHistoryOpen(true);
  };

  const columns: ColumnsType<DeviceItem> = [
    { title: '序列号', dataIndex: 'serialNumber', width: 150 },
    {
      title: '设备类型',
      dataIndex: 'deviceType',
      width: 130,
      render: (v: DeviceType) => DEVICE_TYPE_LABEL[v] || v,
    },
    {
      title: '所属站点',
      dataIndex: ['site', 'name'],
      width: 140,
      render: (v, r) => v || r.siteId,
    },
    { title: '型号', dataIndex: 'model', render: (v) => v || '-' },
    { title: '制造商', dataIndex: 'manufacturer', render: (v) => v || '-' },
    {
      title: '安装日期',
      dataIndex: 'installDate',
      width: 120,
      render: (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => {
        const map: Record<string, { color: string; text: string }> = {
          active: { color: 'green', text: '正常' },
          inactive: { color: 'default', text: '停用' },
          maintenance: { color: 'orange', text: '维护中' },
        };
        const item = map[v] || { color: 'default', text: v };
        return <Tag color={item.color}>{item.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="link" icon={<HistoryOutlined />} onClick={() => openHistory(record.id)}>
            历史
          </Button>
          <Popconfirm title="确认删除该设备？" onConfirm={() => onDelete(record.id)}>
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
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="所属站点"
          style={{ width: 180 }}
          value={siteId}
          onChange={(v) => {
            setPage(1);
            setSiteId(v);
          }}
          options={sites.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          allowClear
          placeholder="设备类型"
          style={{ width: 160 }}
          value={deviceType}
          onChange={(v) => {
            setPage(1);
            setDeviceType(v);
          }}
          options={Object.entries(DEVICE_TYPE_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Input.Search
          placeholder="序列号"
          allowClear
          onSearch={(v) => {
            setPage(1);
            setSerialNumber(v);
          }}
          style={{ width: 180 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增设备
        </Button>
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
          下载导入模板
        </Button>
        <Upload beforeUpload={onImport} showUploadList={false} accept=".xlsx,.xls">
          <Button icon={<UploadOutlined />}>批量导入 Excel</Button>
        </Upload>
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
        title={editing ? '编辑设备' : '新增设备'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="siteId" label="所属站点" rules={[{ required: true }]}>
            <Select
              options={sites.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` }))}
            />
          </Form.Item>
          <Form.Item
            name="serialNumber"
            label="序列号"
            rules={[{ required: true, message: '请输入序列号' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="deviceType" label="设备类型" rules={[{ required: true }]}>
            <Select
              options={Object.entries(DEVICE_TYPE_LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item name="model" label="型号">
            <Input />
          </Form.Item>
          <Form.Item name="manufacturer" label="制造商">
            <Input />
          </Form.Item>
          <Form.Item name="installDate" label="安装日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'active', label: '正常' },
                  { value: 'inactive', label: '停用' },
                  { value: 'maintenance', label: '维护中' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title="设备巡检历史"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={720}
      >
        <h4>任务记录</h4>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={historyData?.tasks || []}
          columns={[
            { title: '任务名称', dataIndex: 'taskName' },
            { title: '状态', dataIndex: 'status', width: 100 },
            { title: '计划日期', dataIndex: 'plannedDate', width: 120 },
          ]}
        />
        <h4 style={{ marginTop: 16 }}>巡检报告</h4>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={historyData?.records || []}
          columns={[
            { title: '记录ID', dataIndex: 'id', ellipsis: true },
            { title: '状态', dataIndex: 'status', width: 100 },
            { title: '提交时间', dataIndex: 'submittedAt', width: 180 },
          ]}
        />
      </Modal>
    </div>
  );
}
