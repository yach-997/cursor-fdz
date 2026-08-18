import { useRef, useState } from 'react';
import { Alert, Button, Modal, Progress, Space, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { downloadFinanceImportTemplate, uploadFinanceExcel } from '../../../api/finance';
import type { ImportResult } from '../../../types/finance';

function KeyList({ items, moreCount }: { items?: string[]; moreCount?: number }) {
  if (!items?.length) return null;
  return (
    <div
      style={{
        marginTop: 6,
        maxHeight: 160,
        overflow: 'auto',
        lineHeight: 1.8,
        wordBreak: 'break-all',
      }}
    >
      {items.join('、')}
      {moreCount && moreCount > 0 ? ` …等共 ${items.length + moreCount} 个` : ''}
    </div>
  );
}

function DupPlanAlert({
  kind,
  plan,
  failCount,
}: {
  kind: 'gsp' | 'po' | 'price' | 'perf-price';
  plan: NonNullable<ImportResult['dupPlan']>;
  failCount: number;
}) {
  const unit = kind === 'po' ? '张' : '条';
  const noName = kind === 'gsp' ? '案例号' : kind === 'po' ? 'PO单号' : '条目';
  const warn =
    plan.updateCount > 0 ||
    plan.fileDupCount > 0 ||
    failCount > 0 ||
    (kind === 'po' && plan.frozenSkipCount > 0);

  const effect =
    kind === 'gsp'
      ? '会改项目名、服务类型、产品线、现场描述；已派网格、工程师、作业进度和结算状态不动。'
      : kind === 'po'
        ? '条目和金额会被这张表整份换掉，未结算的钱会变；已完工但还没结算的，可能回到「待结算审核」。'
        : kind === 'price'
          ? '今天已有的甲方结算单价会改成表里的数；还没结算的 PO 会按新价重算，已结算/已月结的金额不会跟着变。'
          : '同一生效日的绩效单价会改成表里的数；还没结算的会按新价重算，已结算/已月结的不会跟着变。';

  const createEffect =
    kind === 'gsp'
      ? '系统里会出现新案例，还没派网格和工程师。'
      : kind === 'po'
        ? '按案例号挂上；找不到对应案例会进「待匹配」，不会自动派工。'
        : kind === 'price'
          ? '写入今天的甲方结算单价。'
          : '写入内部绩效单价。';

  const more = (count: number, shown: number) => Math.max(0, count - shown);
  const willWrite = Math.max(0, plan.updateCount - (kind === 'po' ? plan.frozenSkipCount : 0));

  return (
    <Alert
      showIcon
      type={warn ? 'warning' : 'info'}
      message="点「确认入库」之后会怎样"
      description={
        <div>
          {plan.updateCount > 0 ? (
            <div style={{ marginTop: 4 }}>
              <b>
                重复 {plan.updateCount} {unit}
              </b>
              （系统里已有这些{noName}，不会变成两条）。
              <KeyList
                items={plan.updateSamples}
                moreCount={more(plan.updateCount, plan.updateSamples.length)}
              />
              {kind === 'po' && plan.frozenSkipCount > 0 ? (
                <>
                  <div style={{ marginTop: 10 }}>
                    <b>其中跳过 {plan.frozenSkipCount} 张</b>
                    ：已结算或已月结，点确认也不会改金额。
                    <KeyList
                      items={plan.frozenSkipSamples}
                      moreCount={more(plan.frozenSkipCount, plan.frozenSkipSamples.length)}
                    />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    其余 {willWrite} 张会按表整份换掉条目和金额，未结算的钱会变；已完工但还没结算的，可能回到「待结算审核」。
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 6 }}>{effect}</div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>没有与系统里已有{noName}重复的记录。</div>
          )}
          {plan.createCount > 0 ? (
            <div style={{ marginTop: 10 }}>
              <b>
                新建 {plan.createCount} {unit}
              </b>
              （这些{noName}系统里还没有）。{createEffect}
              <KeyList
                items={plan.createSamples}
                moreCount={more(plan.createCount, plan.createSamples.length)}
              />
            </div>
          ) : null}
          {plan.fileDupCount > 0 ? (
            <div style={{ marginTop: 10 }}>
              <b>表内重复</b>
              ：这张表里同一号写了多次，多出来 {plan.fileDupCount} 行，只认最后一次。
              <KeyList items={plan.fileDupSamples} />
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>这张表里没有同一号写两遍的情况。</div>
          )}
          <div style={{ marginTop: 10 }}>
            {failCount > 0
              ? `格式问题 ${failCount} 条，见下方明细，这些行不会入库。`
              : '格式问题 0 条。'}
          </div>
        </div>
      }
    />
  );
}

const IMPORT_CHUNK_PO = 80;
/** 价格库每批写入条数（需 ≤ 后端 ImportPreviewQueryDto.limit 上限） */
const IMPORT_CHUNK_PRICE = 200;

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
        const warnCount = data.matchWarnings?.length || data.warnings?.length || 0;
        if (warnCount > 0) {
          message.warning(
            `导入完成：成功 ${data.successRows || 0}，失败 ${data.failRows || 0}；有 ${warnCount} 条匹配提示（不阻断入库）`,
          );
        } else {
          message.success(`导入完成：成功 ${data.successRows || 0}，失败 ${data.failRows || 0}`);
        }
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
      const chunkSize =
        kind === 'price' || kind === 'perf-price' ? IMPORT_CHUNK_PRICE : IMPORT_CHUNK_PO;
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

      const skipped = Number(preview.dupPlan?.frozenSkipCount || last?.skippedFrozen || 0);
      const skipText = kind === 'po' && skipped > 0 ? `，已结算跳过 ${skipped}` : '';
      message.success(
        `导入完成：成功 ${last?.successRows || 0}，失败 ${last?.failRows || 0}${skipText}`,
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
        <p className="ant-upload-hint">先解析并提示新建/更新/跳过，确认后才写入</p>
      </Upload.Dragger>
      {kind === 'gsp' && (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="第一次导入（GSP 基本信息）"
          description="表头需含：服务案例号、项目名称、服务类型、产品线、创建人、省份、城市、失效现象描述。服务类型/产品线按系统配置精确匹配；匹配不上仍会入库，并提示去「服务类型」补同名配置，补好后会自动挂上。"
        />
      )}
      {kind === 'po' && (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="第二次导入（钉钉 PO 表，单文件）"
          description="使用钉钉导出的一张 PO Excel（双行表头）：含 PO单号、GSP案例号/GSP服务案例号、金额与产品信息，以及同表内的专用/通用服务条目（服务条目、说明、单位、数量）。合并单元格格式不统一也可解析。按案例号挂接已有 GSP 案例并补全价格；若案例尚不存在则进入「待匹配」。已结算或已月结的 PO 会跳过，不会改金额。"
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
      {importStatus && !loading && (
        <div style={{ marginTop: 16 }}>
          {(importStatus.matchWarnings?.length || 0) > 0 ? (
            <Alert
              showIcon
              type="warning"
              message={`匹配提示 ${importStatus.matchWarnings!.length} 条（案例已入库，请到「服务类型」补配置）`}
              description={
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, maxHeight: 180, overflow: 'auto' }}>
                  {importStatus.matchWarnings!.slice(0, 30).map((w, i) => (
                    <li key={`${w.gspCaseNo || ''}-${i}`}>
                      {w.gspCaseNo ? `${w.gspCaseNo}：` : w.row ? `第${w.row}行：` : ''}
                      {w.message}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
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
          {preview.dupPlan ? (
            <DupPlanAlert
              kind={kind}
              plan={preview.dupPlan}
              failCount={preview.failures?.length || 0}
            />
          ) : null}
          <Alert
            style={{ marginTop: preview.dupPlan ? 12 : 0 }}
            showIcon
            type={(preview.failures?.length || 0) > 0 ? 'warning' : 'success'}
            message={`已解析 ${preview.totalOrders ?? preview.totalRows ?? 0} 条${
              kind === 'po'
                ? `；原始条目 ${preview.sourceItemRows ?? '-'}，标准化明细 ${preview.normalizedItemCount ?? '-'}`
                : ''
            }；格式问题 ${preview.failures?.length || 0} 条`}
            description={
              (preview.failures?.length || 0) > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, maxHeight: 140, overflow: 'auto' }}>
                  {preview.failures!.slice(0, 20).map((item, i) => (
                    <li key={`${item.row}-${i}`}>
                      第{item.row}行：{item.reason}
                    </li>
                  ))}
                </ul>
              ) : undefined
            }
          />
        </div>
      )}
    </Modal>
  );
}
