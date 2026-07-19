import { useState } from 'react';
import { Alert, Button, Modal, Space, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { uploadFinanceExcel } from '../../../api/finance';
import type { ImportResult } from '../../../types/finance';

export default function ImportDialog({
  open,
  kind,
  title,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: 'gsp' | 'po' | 'price';
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<ImportResult>();
  const [loading, setLoading] = useState(false);
  const run = async (preview: boolean) => {
    if (!file) return message.warning('请先选择Excel文件');
    setLoading(true);
    try {
      const data = await uploadFinanceExcel(kind, file, preview);
      setResult(data);
      if (!preview) {
        message.success(`导入完成：成功 ${data.successRows || 0}，失败 ${data.failRows || 0}`);
        onDone();
      }
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal
      width={760}
      open={open}
      title={title}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button disabled={!file} loading={loading} onClick={() => void run(true)}>
            解析预览
          </Button>
          <Button
            type="primary"
            disabled={!file || !result?.preview}
            loading={loading}
            onClick={() => void run(false)}
          >
            确认入库
          </Button>
        </Space>
      }
    >
      <Upload.Dragger
        accept=".xlsx"
        maxCount={1}
        beforeUpload={(f) => {
          setFile(f);
          setResult(undefined);
          return false;
        }}
        onRemove={() => {
          setFile(undefined);
          setResult(undefined);
        }}
      >
        <p>
          <InboxOutlined style={{ fontSize: 32, color: '#15936b' }} />
        </p>
        <p>点击或拖入 Excel 文件</p>
        <p className="ant-upload-hint">先解析前 20 行并校验，确认后才写入数据库</p>
      </Upload.Dragger>
      {result && (
        <div style={{ marginTop: 16 }}>
          <Alert
            showIcon
            type={(result.failures?.length || 0) > 0 ? 'warning' : 'success'}
            message={`解析完成：${result.totalOrders ?? result.totalRows ?? 0} 个主记录；原始条目 ${result.sourceItemRows ?? '-'}；标准化明细 ${result.normalizedItemCount ?? '-'}；问题 ${result.failures?.length || 0}`}
          />
          <pre className="finance-preview">
            {JSON.stringify(result.preview ?? result.failures ?? result, null, 2)}
          </pre>
        </div>
      )}
    </Modal>
  );
}
