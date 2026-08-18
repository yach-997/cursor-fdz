/** 已知服务类型短名（与 PC「服务类型」配置对齐） */
const KNOWN_SERVICE_TYPES = ['故障恢复', '整改', '维护', '交付', '巡检'] as const;

/**
 * 解析当前作业的服务类型展示名。
 * 优先用案例/任务上的 taskTypeName、serviceType；不要仅因底层 taskType=inspection 就显示「巡检」。
 */
export function resolveWorkTypeLabel(input?: {
  taskTypeName?: string | null;
  serviceType?: string | null;
  taskType?: string | null;
  taskName?: string | null;
  serviceCaseId?: string | null;
  device?: { model?: string | null } | null;
} | null): string {
  const direct = String(input?.taskTypeName || input?.serviceType || '').trim();
  if (direct) {
    // 兼容误存英文 code
    const lower = direct.toLowerCase();
    if (lower === 'inspection') return '巡检';
    if (lower === 'service' || lower === 'maintenance') return '维护';
    if (lower === 'repair' || lower === 'fault') return '故障恢复';
    if (lower === 'rectify') return '整改';
    if (lower === 'delivery') return '交付';
    return direct;
  }

  // 案例详情页常把服务类型放在 device.model 展示
  const model = String(input?.device?.model || '').trim();
  if (model && KNOWN_SERVICE_TYPES.some((k) => model === k || model.includes(k))) {
    for (const k of KNOWN_SERVICE_TYPES) {
      if (model === k || model.startsWith(k) || model.includes(k)) return k;
    }
  }

  const name = String(input?.taskName || '').trim();
  for (const k of KNOWN_SERVICE_TYPES) {
    if (name === k || name.startsWith(`${k}`) || name.includes(`【${k}`) || name.includes(k)) {
      return k;
    }
  }

  // 仅无独立任务（非费用案例）时，才用 taskType 代码推断
  if (!input?.serviceCaseId) {
    const code = String(input?.taskType || '').trim().toLowerCase();
    if (code === 'inspection') return '巡检';
    if (code === 'service' || code === 'maintenance') return '维护';
    if (code === 'repair' || code === 'fault') return '故障恢复';
    if (code === 'rectify') return '整改';
    if (code === 'delivery') return '交付';
  }

  return '作业';
}

export type WorkActionKind =
  | 'accept_start'
  | 'start'
  | 'continue'
  | 'rework'
  | 'progress'
  | 'report'
  | 'executing'
  | 'submitted'
  | 'doing'
  | 'task_noun'
  | 'tip_photo'
  | 'tip_unit';

/** 按服务类型生成现场按钮 / 标题文案 */
export function workActionLabel(
  typeName: string | null | undefined,
  kind: WorkActionKind,
): string {
  const work = String(typeName || '').trim() || '作业';
  switch (kind) {
    case 'accept_start':
      return `接单并开始${work}`;
    case 'start':
      return `开始${work}`;
    case 'continue':
      return `继续${work}`;
    case 'rework':
      return `继续返工${work}`;
    case 'progress':
      return `${work}进度`;
    case 'report':
      return `查看${work}报告`;
    case 'executing':
      return `${work}执行`;
    case 'submitted':
      return `${work}已提交`;
    case 'doing':
      return `${work}中`;
    case 'task_noun':
      return `${work}作业`;
    case 'tip_photo':
      return `按检查条目现场拍照完成${work}；提交后系统辅助分析生成报告，并自动完工。行程与费用请在作业详情底部按需填写（每人各填自己的）。`;
    case 'tip_unit':
      return `可同时认领多台：某台暂时做不完可先放着，继续认领其他台。提交报告后自动完成本台；全部完成后案例进入结算。行程与费用在作业详情底部可选填写，不按台重复问。`;
    default:
      return work;
  }
}

/** 历史记录折叠标题：按服务类型，避免写死「历史故障 / 巡检记录」 */
export function historyRecordsTitle(typeName: string | null | undefined): string {
  const work = String(typeName || '').trim();
  if (work === '故障恢复') return '历史故障记录';
  if (work) return `历史${work}记录`;
  return '历史作业记录';
}
