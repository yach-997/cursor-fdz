import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NavBar, Cell, Button, Empty, Toast, Tag, Collapse, Dialog } from 'react-vant';
import { fetchTask, startTask, deleteTask, type TaskItem } from '../../api/task';
import { fetchDeviceHistory, type DeviceHistory } from '../../api/device';
import { formatDateTime } from '../../utils/displayLabels';
import {
  historyRecordsTitle,
  resolveWorkTypeLabel,
  workActionLabel,
} from '../../utils/workTypeLabels';

const STATUS_TEXT: Record<string, string> = {
  pending: '未开始',
  in_progress: '进行中',
  submitted: '已完成',
  approved: '已完成',
  rejected: '已驳回',
  archived: '已归档',
};

const DEVICE_TYPE: Record<string, string> = {
  string_inverter: '组串式逆变器',
  central_inverter: '集中式逆变器',
  energy_storage: '储能系统',
};

const RECORD_STATUS: Record<string, string> = {
  draft: '进行中',
  submitted: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档',
};

/** 作业信息（遗留页）：继续拍照 / 查看报告 / 删除未绑定案例的作业 */
export default function TaskDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState<DeviceHistory | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchTask(id)
      .then((t) => {
        setTask(t);
        if (t.deviceId) {
          fetchDeviceHistory(t.deviceId).then(setHistory).catch(() => undefined);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [id]);

  const onStart = async () => {
    if (!id) return;
    setStarting(true);
    try {
      const updated = await startTask(id);
      setTask(updated);
      navigate(`/m/inspection/${id}`);
    } catch {
      /* 拦截器 */
    } finally {
      setStarting(false);
    }
  };

  const onDelete = async () => {
    if (!id || !task) return;
    try {
      await Dialog.confirm({
        title: '删除作业',
        message: '删除后可重新创建，现场已拍照片也会清除，确认删除？',
        confirmButtonText: '删除',
        confirmButtonColor: '#ee0a24',
      });
    } catch {
      return;
    }
    setDeleting(true);
    try {
      await deleteTask(id);
      Toast.success('作业已删除');
      navigate('/m/tasks', { replace: true });
    } catch {
      /* 拦截器 */
    } finally {
      setDeleting(false);
    }
  };

  const canStart =
    task &&
    (task.status === 'pending' || task.status === 'rejected' || task.status === 'in_progress');

  const canDelete =
    task &&
    !task.serviceCaseId &&
    ['pending', 'in_progress', 'rejected', 'archived'].includes(task.status);

  const reject = task?.record?.rejectReason;
  const rejectedEntryNames = useMemo(() => {
    if (!task || !reject?.entryIds?.length) return [] as string[];
    const map = new Map((task.templateSnapshot || []).map((e) => [e.id, e.name]));
    return reject.entryIds.map((eid) => map.get(eid) || eid.slice(0, 8));
  }, [task, reject]);

  const statusText = (() => {
    const label = task?.statusLabel?.trim();
    if (label && label !== '草稿') return label;
    if (reject?.reason && (task?.status === 'in_progress' || task?.status === 'rejected')) {
      return task?.status === 'rejected' ? '已驳回' : '待整改';
    }
    return STATUS_TEXT[task?.status || ''] || '进行中';
  })();

  const isRejectedView =
    !!reject?.reason || task?.status === 'rejected' || task?.statusLabel === '已驳回' ||
    task?.statusLabel === '待整改';

  const workType = resolveWorkTypeLabel(task);

  return (
    <div>
      <NavBar title="作业信息" leftText="返回" onClickLeft={() => navigate(-1)} />
      {loading || !task ? (
        <Empty description={loading ? '加载中...' : '作业不存在'} />
      ) : (
        <>
          <Cell.Group inset title="基本信息">
            <Cell title="名称" value={task.taskName} />
            <Cell
              title="状态"
              value={
                <Tag type={isRejectedView ? 'danger' : 'primary'} plain>
                  {statusText}
                </Tag>
              }
            />
            <Cell title="所属区域/现场" value={task.site?.name || '-'} />
            <Cell title="创建时间" value={formatDateTime(task.createdAt)} />
          </Cell.Group>

          {reject?.reason && (
            <div
              style={{
                margin: '12px 16px 0',
                padding: 12,
                background: '#fff1f0',
                border: '1px solid #ffa39e',
                borderRadius: 8,
                fontSize: 13,
                color: '#a8071a',
                lineHeight: 1.55,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>管理员已驳回，请按意见返工</div>
              <div>原因：{reject.reason}</div>
              {rejectedEntryNames.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  需返工检查项：
                  {rejectedEntryNames.map((n) => (
                    <Tag key={n} type="danger" style={{ marginLeft: 6, marginTop: 4 }}>
                      {n}
                    </Tag>
                  ))}
                </div>
              )}
              {!rejectedEntryNames.length && (
                <div style={{ marginTop: 6, color: '#cf1322' }}>整份报告需返工后重新提交</div>
              )}
            </div>
          )}

          <Cell.Group
            inset
            title={task.serviceCaseId ? '案例信息' : '设备信息'}
            style={{ marginTop: 12 }}
          >
            {task.serviceCaseId || String(task.device?.serialNumber || '').startsWith('CASE-') ? (
              <Cell
                title="案例号"
                value={
                  String(task.device?.serialNumber || '')
                    .replace(/^CASE-/, '')
                    .replace(/-\d+$/, '') || '-'
                }
              />
            ) : (
              <Cell title="序列号" value={task.device?.serialNumber || '-'} />
            )}
            <Cell
              title={task.serviceCaseId ? '服务类型' : '设备类型'}
              value={
                task.serviceCaseId
                  ? task.device?.model || DEVICE_TYPE[task.device?.deviceType || ''] || '-'
                  : DEVICE_TYPE[task.device?.deviceType || ''] || '未知设备类型'
              }
            />
            {!task.serviceCaseId && (
              <Cell title="型号" value={task.device?.model || '-'} />
            )}
          </Cell.Group>

          <div style={{ margin: '12px 16px' }}>
            <Collapse initExpanded={[]}>
              <Collapse.Item title="检查条目预览" name="1">
                {(task.templateSnapshot || []).length === 0 ? (
                  <Empty description="无模板快照" />
                ) : (
                  (task.templateSnapshot || []).map((e) => {
                    const needRedo = !!reject?.entryIds?.includes(e.id);
                    return (
                      <div
                        key={e.id}
                        style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {e.name}{' '}
                          {e.isRequired ? <Tag type="danger">必填</Tag> : <Tag>选填</Tag>}
                          {needRedo ? (
                            <Tag type="danger" style={{ marginLeft: 6 }}>
                              需返工
                            </Tag>
                          ) : null}
                        </div>
                        <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                          {e.description}
                        </div>
                      </div>
                    );
                  })
                )}
              </Collapse.Item>
              <Collapse.Item title={historyRecordsTitle(workType)} name="2">
                {!history?.records?.length ? (
                  <Empty description="暂无历史记录" imageSize={64} />
                ) : (
                  history.records.slice(0, 10).map((r) => {
                    const related = history.tasks.find((t) => t.id === r.taskId);
                    return (
                      <div
                        key={r.id}
                        style={{
                          padding: '8px 0',
                          borderBottom: '1px solid #f0f0f0',
                          fontSize: 13,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {related?.taskName || workActionLabel(workType, 'task_noun')}
                        </div>
                        <div style={{ color: '#888', marginTop: 4 }}>
                          状态 {RECORD_STATUS[r.status] || '未知状态'}
                          {r.submittedAt ? ` · 提交 ${formatDateTime(r.submittedAt)}` : ''}
                        </div>
                      </div>
                    );
                  })
                )}
              </Collapse.Item>
            </Collapse>
          </div>

          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            {task.record?.id &&
              ['submitted', 'approved', 'rejected'].includes(task.status) && (
                <Button
                  type="primary"
                  block
                  round
                  style={{ height: 48 }}
                  onClick={() => navigate(`/m/report/${task.record!.id}`)}
                >
                  {workActionLabel(workType, 'report')}
                </Button>
              )}
            <Button
              type={canStart ? 'primary' : 'default'}
              block
              round
              style={{ height: 48 }}
              disabled={!canStart}
              loading={starting}
              onClick={() => void onStart()}
            >
              {task.status === 'pending'
                ? workActionLabel(workType, 'start')
                : reject?.reason
                  ? '去返工'
                  : workActionLabel(workType, 'continue')}
            </Button>
            {canDelete && (
              <Button
                block
                round
                plain
                type="danger"
                style={{ height: 48 }}
                loading={deleting}
                onClick={() => void onDelete()}
              >
                删除作业
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
