import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  Tabs,
  message,
} from 'antd';
import { ApartmentOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { createPrice, fetchPrices, updatePrice } from '../../../api/finance';
import type { PriceItem } from '../../../types/finance';
import { useAuthStore } from '../../../stores/auth';
import ImportDialog from '../components/ImportDialog';
import ItemMappingDialog from './ItemMappingDialog';

const scenes = ['平地', '水上', '山地', '高原', '屋顶'];
export default function PricesPage() {
  const user = useAuthStore((s) => s.user),
    [type, setType] = useState<'settle' | 'perf'>('settle'),
    [data, setData] = useState<PriceItem[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [keyword, setKeyword] = useState(''),
    [loading, setLoading] = useState(false),
    [editing, setEditing] = useState<PriceItem | null>(),
    [modalOpen, setModalOpen] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [mappingOpen, setMappingOpen] = useState(false),
    [form] = Form.useForm();
  const admin = user?.role === 'super_admin';
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchPrices({ page, limit: 10, type, keyword });
      setData(r.list);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, type, keyword]);
  useEffect(() => {
    void load();
  }, [load]);
  const openEdit = (item?: PriceItem) => {
    setEditing(item || null);
    form.setFieldsValue(
      item || {
        priceType: type,
        effectiveDate: new Date().toISOString().slice(0, 10),
        status: 'active',
      },
    );
    setModalOpen(true);
  };
  const submit = async () => {
    const values = await form.validateFields();
    if (editing) await updatePrice(editing.id, values);
    else await createPrice(values);
    message.success('价格已保存');
    setModalOpen(false);
    void load();
  };
  return (
    <Card className="finance-card">
      <div className="finance-toolbar">
        <Input.Search
          allowClear
          placeholder="条目编码或名称"
          onSearch={(v) => {
            setPage(1);
            setKeyword(v);
          }}
        />
        {admin && (
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>
              新增价格
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => setImportOpen(true)}>
              从附件1初始化结算价
            </Button>
            <Button icon={<ApartmentOutlined />} onClick={() => setMappingOpen(true)}>
              条目映射维护
            </Button>
          </>
        )}
      </div>
      <Tabs
        activeKey={type}
        onChange={(v) => {
          setPage(1);
          setType(v as any);
        }}
        items={[
          { key: 'settle', label: '甲方结算价' },
          { key: 'perf', label: '内部绩效价' },
        ]}
      />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        scroll={{ x: 1100 }}
        columns={[
          { title: '条目编码', dataIndex: 'itemCode', width: 240 },
          { title: '名称', dataIndex: 'itemName', width: 180 },
          { title: '型号', dataIndex: 'productModel', width: 100, render: (v) => v || '通用' },
          { title: '场景', dataIndex: 'scene', width: 80, render: (v) => v || '通用' },
          {
            title: '区域',
            dataIndex: 'region',
            width: 90,
            render: (v) => (v === 'yunnan' ? '云南' : v === 'south_china' ? '华南' : '通用'),
          },
          { title: '单位', dataIndex: 'unit', width: 70 },
          { title: '工时', dataIndex: 'workHours', width: 80 },
          {
            title: '单价',
            dataIndex: 'unitPrice',
            width: 120,
            render: (v) => <b className="finance-money">¥ {Number(v).toFixed(2)}</b>,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 80,
            render: (v) => (
              <Tag color={v === 'active' ? 'success' : 'default'}>
                {v === 'active' ? '启用' : '停用'}
              </Tag>
            ),
          },
          { title: '生效日期', dataIndex: 'effectiveDate', width: 110 },
          {
            title: '操作',
            width: 80,
            render: (_, r) =>
              admin ? (
                <Button type="link" onClick={() => openEdit(r)}>
                  编辑
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        width={680}
        open={modalOpen}
        title={editing ? '编辑价格' : '新增价格'}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="priceType" label="价格类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'settle', label: '甲方结算价' },
                { value: 'perf', label: '内部绩效价' },
              ]}
            />
          </Form.Item>
          <Form.Item name="itemCode" label="条目编码" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="itemName" label="条目名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="productModel" label="产品型号">
            <Input placeholder="留空表示通用" />
          </Form.Item>
          <Form.Item name="scene" label="项目场景">
            <Select allowClear options={scenes.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="region" label="区域">
            <Select
              allowClear
              options={[
                { value: 'south_china', label: '华南' },
                { value: 'yunnan', label: '云南' },
              ]}
            />
          </Form.Item>
          <Form.Item name="coopType" label="合作类型">
            <Select
              allowClear
              options={[
                { value: 'self', label: '自做单' },
                { value: 'coop', label: '合作单' },
              ]}
            />
          </Form.Item>
          <Form.Item name="unit" label="单位">
            <Input />
          </Form.Item>
          <Form.Item name="workHours" label="工时">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unitPrice" label="单价" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="effectiveDate" label="生效日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'inactive', label: '停用' },
              ]}
            />
          </Form.Item>
          <Form.Item name="changeRemark" label="调价备注">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      <ImportDialog
        open={importOpen}
        kind="price"
        title="从附件1初始化结算价"
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          void load();
        }}
      />
      <ItemMappingDialog
        open={mappingOpen}
        onClose={() => setMappingOpen(false)}
        onChanged={() => void load()}
      />
    </Card>
  );
}
