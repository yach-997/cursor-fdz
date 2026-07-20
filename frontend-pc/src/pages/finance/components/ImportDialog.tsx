import { useRef, useState } from 'react';
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
  const [preview, setPreview] = useState<ImportResult>();
  const [importStatus, setImportStatus] = useState<ImportResult>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const resumeRef = useRef<{ offset: number; batchId?: string }>({ offset: 0 });

  const reset = () => {
    setFile(undefined);
    setPreview(undefined);
    setImportStatus(undefined);
    setProgress(null);
    resumeRef.current = { offset: 0 };
  };

  const runPreview = async () => {
    if (!file) return message.warning('请先选择Excel文件');
    setLoading(true);
    setProgress(null);
    setImportStatus(undefined);
    resumeRef.current = { offset: 0 };
    try {
      const data = await uploadFinanceExcel(kind, file, true);
      setPreview(data);
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setLoading(false);
    }
  };

  const runConfirm = async (resume = false) => {
    if (!file) return message.warning('请先选择Excel文件');
    if (!preview?.preview) return message.warning('请先解析预览');
    setLoading(true);
    try {
      if (kind === 'gsp') {
        const data = await uploadFinanceExcel(kind, file, false);
        setImportStatus(data);
        message.success(`导入完成：成功 ${data.successRows || 0}，失败 ${data.failRows || 0}`);
        onDone();
        return;
      }

      const totalHint =
        kind === 'po' ? Number(preview.totalOrders || 0) : Number(preview.totalRows || 0);
      let offset = resume
        ? Number(importStatus?.nextOffset ?? resumeRef.current.offset ?? 0)
        : 0;
      let batchId = resume
        ? importStatus?.batchId || resumeRef.current.batchId
        : undefined;
      let last: ImportResult | undefined;
      const chunkSize = kind === 'price' ? 15 : IMPORT_CHUNK;
      setProgress({ current: offset, total: totalHint || 1 });

      while (true) {
        last = await uploadFinanceExcel(kind, file, false, {
          offset,
          limit: chunkSize,
          batchId,
        });
        batchId = last.batchId;
        const total = Number(last.totalOrders ?? last.totalRows ?? totalHint) || 1;
        if (last.nextOffset == null && last.done == null) {
          setProgress({ current: total, total });
          setImportStatus(last);
          resumeRef.current = { offset: total, batchId };
          break;
        }
        offset = Number(last.nextOffset ?? total);
        resumeRef.current = { offset, batchId };
        setProgress({ current: Math.min(offset, total), total });
        setImportStatus(last);
        if (last.done || offset >= total) break;
      }

      message.success(
        `导入完成：成功 ${last?.successRows || 0}，失败 ${last?.failRows || 0}`,
      );
      onDone();
    } catch (error) {
      const detail = error instanceof Error && error.message ? `（${error.message}）` : '';
      message.warning(`入库中断${detail}，可点击「继续入库」从断点续传`);
    } finally {
      setLoading(false);
    }
  };

  const canResume =
    !!file &&
    !!preview?.preview &&
    !!importStatus &&
    importStatus.done === false &&
    Number(importStatus.nextOffset || 0) > 0;

  return (
    <Modal
      width={760}
      open={open}
      title={title}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button disabled={!file || loading} onClick={() => void runPreview()}>
            解析预览
          </Button>
          {canResume && (
            <Button loading={loading} onClick={() => void runConfirm(true)}>
              继续入库
            </Button>
          )}
          <Button
            type="primary"
            disabled={!file || !preview?.preview}
            loading={loading}
            onClick={() => void runConfirm(false)}
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
          setPreview(undefined);
          setImportStatus(undefined);
          setProgress(null);
          resumeRef.current = { offset: 0 };
          return false;
        }}
        onRemove={reset}
      >
        <p>
          <InboxOutlined style={{ fontSize: 32, color: '#15936b' }} />
        </p>
        <p>点击或拖入 Excel 文件</p>
        <p className="ant-upload-hint">先解析前 20 行并校验，确认后才写入数据库</p>
      </Upload.Dragger>
      {(loading || progress) && progress && (
        <div style={{ marginTop: 16 }}>
          <Alert
            showIcon
            type="info"
            message={`正在入库 ${progress.current} / ${progress.total}…`}
          />
          <Progress
            percent={Math.round((progress.current / Math.max(progress.total, 1)) * 100)}
            status={loading ? 'active' : importStatus?.done ? 'success' : 'exception'}
            style={{ marginTop: 8 }}
          />
        </div>
      )}
      {importStatus && !loading && importStatus.done === false && (
        <div style={{ marginTop: 16 }}>
          <Alert
            showIcon
            type="warning"
            message={`已写入 ${importStatus.successRows || 0} / ${importStatus.totalOrders ?? importStatus.totalRows ?? 0}，未完成。请点「继续入库」。`}
          />
        </div>
      )}
      {preview && (
        <div style={{ marginTop: 16 }}>
          <Alert
            showIcon
            type={(preview.failures?.length || 0) > 0 ? 'warning' : 'success'}
            message={`解析完成：${preview.totalOrders ?? preview.totalRows ?? 0} 个主记录；原始条目 ${preview.sourceItemRows ?? '-'}；标准化明细 ${preview.normalizedItemCount ?? '-'}；问题 ${preview.failures?.length || 0}`}
          />
          <pre className="finance-preview">
            {JSON.stringify(preview.preview ?? preview.failures ?? preview, null, 2)}
          </pre>
        </div>
      )}
    </Modal>
  );
}
