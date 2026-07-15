import { useCallback, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Tag, message } from 'antd';
import { AimOutlined, EnvironmentOutlined, SearchOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import MapPicker from '../../components/MapPicker';
import { geocodeAddress, reverseGeocode } from '../../api/geocode';
import type { SiteItem } from '../../types';
import { composeFullAddress, parseChineseAddress } from '../../utils/addressParse';

interface SiteFormModalProps {
  open: boolean;
  editing: SiteItem | null;
  form: FormInstance;
  onCancel: () => void;
  onSubmit: () => void;
}

/** 把完整地址同步到后端所需的省市区 + address 字段 */
function syncRegionFields(form: FormInstance, fullRaw?: string) {
  const full = (fullRaw ?? form.getFieldValue('fullAddress') ?? '').trim();
  if (!full) return false;

  const parsed = parseChineseAddress(full);
  const province = parsed.province || form.getFieldValue('province');
  const city = parsed.city || form.getFieldValue('city');
  const district = parsed.district || form.getFieldValue('district');

  form.setFieldsValue({
    province: province || undefined,
    city: city || undefined,
    district: district || undefined,
    address: parsed.detail || full,
    fullAddress: full,
  });

  return Boolean(province && city && district);
}

/** 新增/编辑站点：完整地址输入 + 定位 */
export default function SiteFormModal({
  open,
  editing,
  form,
  onCancel,
  onSubmit,
}: SiteFormModalProps) {
  const watchLat = Form.useWatch('latitude', form);
  const watchLng = Form.useWatch('longitude', form);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const hasCoords = watchLat != null && watchLng != null;

  /** 浏览器 GPS 现场定位 */
  const locateHere = useCallback(() => {
    if (!navigator.geolocation) {
      message.warning('当前浏览器不支持定位，请填写完整地址后点「解析」');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(7));
        const lng = Number(pos.coords.longitude.toFixed(7));
        form.setFieldsValue({ latitude: lat, longitude: lng });
        try {
          const addr = await reverseGeocode(lng, lat);
          const existing = (form.getFieldValue('fullAddress') as string)?.trim() || '';
          const keep =
            existing.length > 10 &&
            (existing.includes('大学') ||
              existing.includes('学院') ||
              existing.length > (addr.displayName || '').length);

          if (!keep) {
            const full = composeFullAddress({
              province: addr.province,
              city: addr.city,
              district: addr.district,
              address: addr.address,
            });
            form.setFieldsValue({
              fullAddress: full || addr.displayName,
              province: addr.province || undefined,
              city: addr.city || undefined,
              district: addr.district || undefined,
              address: addr.address || addr.displayName,
            });
          } else {
            form.setFieldsValue({
              province: addr.province || undefined,
              city: addr.city || undefined,
              district: addr.district || undefined,
            });
          }
          message.success(`已现场定位：${addr.displayName}`);
        } catch {
          message.success('已获取当前坐标，可拖动地图微调');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        message.error('定位失败，请允许浏览器获取位置，或填写完整地址后点「解析」');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, [form]);

  /** 按完整地址解析坐标；省市区直接使用已拆分的表单地址 */
  const locateByAddress = useCallback(async () => {
    const full = (form.getFieldValue('fullAddress') as string)?.trim();
    const name = form.getFieldValue('name');
    if ((!full || full.length < 4) && !name) {
      message.warning('请先填写完整地址，再点解析');
      return;
    }

    const queryText = full || name;
    const local = parseChineseAddress(queryText);
    const secondDistrict = local.detail.match(/^(.+?(?:区|县|旗|新区))/)?.[1];
    if (local.district && secondDistrict && secondDistrict !== local.district) {
      message.error(
        `地址同时包含「${local.district}」和「${secondDistrict}」，请只保留站点实际所在的区/县后再解析`,
      );
      return;
    }
    syncRegionFields(form, queryText);

    setGeocoding(true);
    try {
      const result = await geocodeAddress({
        address: queryText,
        province: local.province || undefined,
        city: local.city || undefined,
        district: local.district || undefined,
        detail: local.detail || queryText,
        name,
      });
      form.setFieldsValue({
        latitude: result.latitude,
        longitude: result.longitude,
        province: local.province || form.getFieldValue('province') || undefined,
        city: local.city || form.getFieldValue('city') || undefined,
        district: local.district || form.getFieldValue('district') || undefined,
        address: local.detail || queryText,
        fullAddress: full || queryText,
      });

      message.success(`已按地址定位：${result.displayName}`);
    } finally {
      setGeocoding(false);
    }
  }, [form]);

  const handleOk = () => {
    const full = (form.getFieldValue('fullAddress') as string)?.trim();
    if (!full) {
      message.warning('请填写完整地址');
      return;
    }
    const ok = syncRegionFields(form, full);
    if (!ok) {
      message.warning('请按「省+市+区/县+详细地点」填写，例如：四川省自贡市荣县xxx镇1号');
      return;
    }
    onSubmit();
  };

  return (
    <Modal
      title={editing ? '编辑站点' : '新增站点'}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      width={640}
      destroyOnClose
      okText={editing ? '保存' : '创建'}
      cancelText="取消"
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item
          name="name"
          label="站点名称"
          rules={[{ required: true, message: '请输入站点名称' }]}
        >
          <Input placeholder="如：西华大学光伏电站" />
        </Form.Item>
        <Form.Item
          name="code"
          label="站点编码"
          rules={[{ required: true, message: '请输入编码' }]}
        >
          <Input placeholder="如：001" disabled={!!editing} />
        </Form.Item>

        <Form.Item
          name="fullAddress"
          label="完整地址"
          rules={[{ required: true, message: '请输入完整地址' }]}
          extra="格式：省 + 市 + 区/县 + 详细地点。例：四川省自贡市自流井区某某路1号；四川省宜宾市翠屏区四川轻化工大学；四川省自贡市荣县某某镇某某村"
        >
          <Input.Search
            placeholder="例：四川省自贡市荣县某某镇 / 四川省宜宾市翠屏区四川轻化工大学"
            enterButton="解析"
            loading={geocoding}
            onSearch={() => void locateByAddress()}
            onBlur={() => syncRegionFields(form)}
          />
        </Form.Item>

        <Form.Item name="province" hidden rules={[{ required: true, message: '地址需含省份' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="city" hidden rules={[{ required: true, message: '地址需含城市' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="district" hidden rules={[{ required: true, message: '地址需含区县' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="address" hidden rules={[{ required: true, message: '请输入地址' }]}>
          <Input />
        </Form.Item>

        <div
          style={{
            background: '#f7faf8',
            borderRadius: 12,
            padding: '14px 16px 16px',
            marginBottom: 16,
            border: '1px solid #e8eeea',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span style={{ fontWeight: 600, color: '#1a5f4a' }}>地图选点</span>
            {hasCoords && (
              <Tag color="success" style={{ margin: 0 }}>
                {Number(watchLng).toFixed(5)}, {Number(watchLat).toFixed(5)}
              </Tag>
            )}
          </div>

          <Space wrap style={{ marginBottom: 12 }}>
            <Button icon={<AimOutlined />} loading={locating} onClick={locateHere}>
              现场定位
            </Button>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={geocoding}
              onClick={() => void locateByAddress()}
            >
              地址解析
            </Button>
          </Space>

          {open && (
            <MapPicker
              compact
              latitude={watchLat ?? 30.5728}
              longitude={watchLng ?? 104.0668}
              height={260}
              onChange={(lat, lng) => form.setFieldsValue({ latitude: lat, longitude: lng })}
            />
          )}

          <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
            <EnvironmentOutlined /> 点击地图或拖动标记可微调位置
          </div>
        </div>

        <Form.Item name="latitude" hidden rules={[{ required: true, message: '请定位站点' }]}>
          <Input type="hidden" />
        </Form.Item>
        <Form.Item name="longitude" hidden rules={[{ required: true, message: '请定位站点' }]}>
          <Input type="hidden" />
        </Form.Item>

        <Form.Item
          name="inspectionRadiusMeters"
          label="巡检定位范围"
          initialValue={500}
          rules={[{ required: true, message: '请设置巡检定位范围' }]}
          extra="巡检员只有在这个范围内才能现场拍照和提交报告。建议普通站点 300–500 米，大型园区可适当放宽。"
        >
          <InputNumber
            min={50}
            max={5000}
            step={50}
            precision={0}
            addonAfter="米"
            style={{ width: '100%' }}
          />
        </Form.Item>

        {editing && (
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'inactive', label: '停用' },
              ]}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
