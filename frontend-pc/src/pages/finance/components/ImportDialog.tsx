import { useRef, useState } from 'react';
import { Alert, Button, Modal, Progress, Space, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { downloadFinanceImportTemplate, uploadFinanceExcel } from '../../../api/finance';
import type { ImportResult } from '../../../types/finance';

const IMPORT_CHUNK = 25;

const templateKindMap: Record<
  'gsp' | 'po' | 'price' | 'perf-price',
  'gsp' | 'po' | 'settle-price' | 'perf-price'
> = {
  gsp: 'gsp',
  po: 'po',
  price: 'settle-price',
  'perf-price': 'perf-price',
};

export default function ImportDialog({
  open,
  kind,
  title,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: 'gsp' | 'po' | 'price' | 'perf-price';
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ImportResult>();
  const [importStatus, setImportStatus] = useState<ImportResult>();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const resumeRef = useRef<{ offset: number; batchId?: string }>({ offset: 0 });

  const reset = () => {
    setFile(undefined);
    setPreview(undefined);
    setImportStatus(undefined);
    setProgress(null);
    resumeRef.current = { offset: 0 };
  };

  const onDownloadTemplate = async () => {
    setDownloading(true);
    try {
      await downloadFinanceImportTemplate(templateKindMap[kind]);
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setDownloading(false);
    }
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
      const chunkSize = kind === 'price' || kind === 'perf-price' ? 15 : IMPORT_CHUNK;
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
          <Button
            icon={<DownloadOutlined />}
            loading={downloading}
            onClick={() => void onDownloadTemplate()}
          >
            下载模板
          </Button>
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
      <Alert
        style={{ marginBottom: 12 }}
        type="success"
        showIcon
        message="建议先下载模板，按表头填写后再导入"
        description="第一次使用请点「下载模板」；钉钉 PO 也可直接用钉钉导出原表。甲方结算价既可用清单模板，也可用正式附件1。"
      />
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
      {kind === 'gsp' && (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="第一次导入（GSP 基本信息）"
          description="表头需含：服务案例号、项目名称、服务类型、创建人、省份、城市、失效现象描述。导入后即可分配站点/派工程师开工；项目名称允许为空。"
        />
      )}
      {kind === 'po' && (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="第二次导入（钉钉 PO 表，单文件）"
          description="使用钉钉导出的一张 PO Excel（双行表头）：含 PO单号、GSP案例号、金额与产品信息，以及同表内的专用/通用服务条目（条目、说明、单位、数量）。不是两份表。按案例号挂接已有 GSP 案例并补全价格；若案例尚不存在则进入「待匹配」。"
        />
      )}
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
