import { useState } from 'react';
import { Alert, Button, Modal, Progress, Space, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { uploadFinanceExcel } from '../../../api/finance';
import type { ImportResult } from '../../../types/finance';

const IMPORT_CHUNK = 25;

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
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const runPreview = async () => {
    if (!file) return message.warning('请先选择Excel文件');
    setLoading(true);
    setProgress(null);
    try {
      const data = await uploadFinanceExcel(kind, file, true);
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  const runConfirm = async () => {
    if (!file) return message.warning('请先选择Excel文件');
    if (!result?.preview) return message.warning('请先解析预览');
    setLoading(true);
    try {
      if (kind === 'gsp') {
        const data = await uploadFinanceExcel(kind, file, false);
        setResult(data);
        message.success(`导入完成：成功 ${data.successRows || 0}，失败 ${data.failRows || 0}`);
        onDone();
        return;
      }

      const totalHint =
        kind === 'po' ? Number(result.totalOrders || 0) : Number(result.totalRows || 0);
      let offset = 0;
      let batchId: string | undefined;
      let last: ImportResult | undefined;
      setProgress({ current: 0, total: totalHint || 1 });

      while (true) {
        last = await uploadFinanceExcel(kind, file, false, {
          offset,
          limit: IMPORT_CHUNK,
          batchId,
        });
        batchId = last.batchId;
        const total = Number(last.totalOrders ?? last.totalRows ?? totalHint) || 1;
        // 旧后端一次写完全部时没有 nextOffset/done，直接结束，避免重复入库
        if (last.nextOffset == null && last.done == null) {
          setProgress({ current: total, total });
          setResult(last);
          break;
        }
        offset = Number(last.nextOffset ?? total);
        setProgress({ current: Math.min(offset, total), total });
        setResult(last);
        if (last.done || offset >= total) break;
      }

      message.success(
        `导入完成：成功 ${last?.successRows || 0}，失败 ${last?.failRows || 0}`,
      );
      onDone();
    } finally {
      setLoading(false);
      setProgress(null);
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
          <Button disabled={!file} loading={loading} onClick={() => void runPreview()}>
            解析预览
          </Button>
          <Button
            type="primary"
            disabled={!file || !result?.preview}
            loading={loading}
            onClick={() => void runConfirm()}
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
          setProgress(null);
          return false;
        }}
        onRemove={() => {
          setFile(undefined);
          setResult(undefined);
          setProgress(null);
        }}
      >
        <p>
          <InboxOutlined style={{ fontSize: 32, color: '#15936b' }} />
        </p>
        <p>点击或拖入 Excel 文件</p>
        <p className="ant-upload-hint">先解析前 20 行并校验，确认后才写入数据库</p>
      </Upload.Dragger>
      {progress && (
        <div style={{ marginTop: 16 }}>
          <Alert
            showIcon
            type="info"
            message={`正在入库 ${progress.current} / ${progress.total}…`}
          />
          <Progress
            percent={Math.round((progress.current / Math.max(progress.total, 1)) * 100)}
            status="active"
            style={{ marginTop: 8 }}
          />
        </div>
      )}
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
