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
  | 'history'
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
      return `${work}任务`;
    case 'history':
      // 故障恢复习惯叫「历史故障」；其余用「历史{服务类型}记录」
      if (work === '故障恢复') return '历史故障记录';
      return `历史${work}记录`;
    case 'tip_photo':
      return `按检查条目现场拍照完成${work}；提交后系统辅助分析生成报告，并自动完工（若未填结束里程会先引导补填）。`;
    case 'tip_unit':
      return `可同时认领多台：某台暂时做不完可先放着，继续认领其他台。提交报告后自动完成本台（需已填结束里程）；全部完成后案例进入结算。`;
    default:
      return work;
  }
}
