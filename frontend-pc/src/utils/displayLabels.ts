export const TASK_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '未开始',
  in_progress: '进行中',
  submitted: '待审核',
  approved: '已完成',
  rejected: '需返工',
  archived: '已归档',
};

export const RECORD_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  submitted: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档',
};

export const CHECK_RESULT_LABEL: Record<string, string> = {
  pass: '合格',
  fail: '不合格',
  pending: '分析中',
  processing: '分析中',
  error: '分析失败，待人工判断',
  manual: '人工判断',
};

export const ALERT_SEVERITY_LABEL: Record<string, string> = {
  info: '提示',
  warning: '警告',
  critical: '严重',
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  submitted: '提交',
  resubmitted: '重新提交',
  reopened: '重新开启',
  auto_approved: '自动通过',
  approved: '管理员通过',
  rejected: '管理员驳回',
};

export function displayLabel(
  labels: Record<string, string>,
  value: unknown,
  fallback = '未知',
) {
  if (value === null || value === undefined || value === '') return '-';
  return labels[String(value)] || fallback;
}

/** 用户提示只保留中文说明，底层英文异常仍由控制台记录。 */
export function chineseErrorMessage(value: unknown, fallback = '操作失败，请稍后重试') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/network error|failed to fetch|load failed|socket hang up|econnreset|econnrefused/i.test(raw)) {
    return '网络连接失败，请检查网络后重试';
  }
  if (/timeout|timed out|exceeded/i.test(raw)) return '请求超时，请稍后重试';
  if (/request failed with status code|internal server error|bad gateway|service unavailable/i.test(raw)) {
    return '服务暂时不可用，请稍后重试';
  }
  if (/unauthorized|invalid token|jwt/i.test(raw)) return '登录已过期，请重新登录';
  if (/forbidden|permission denied/i.test(raw)) return '暂无操作权限';
  if (/not found/i.test(raw)) return '请求的数据不存在';
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  return fallback;
}
