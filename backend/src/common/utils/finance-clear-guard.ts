import { BadRequestException, ForbiddenException } from '@nestjs/common';

/** 危险清空操作确认文案（前后端一致） */
export const FINANCE_CLEAR_CONFIRM_TEXT = '清空';

/**
 * 生产环境禁止一键清空；Preview / 本地 / 显式开关可放行。
 * 仍必须超级管理员 + 确认文案。
 */
export function assertFinanceClearAllowed(confirm?: string) {
  if (String(confirm || '').trim() !== FINANCE_CLEAR_CONFIRM_TEXT) {
    throw new BadRequestException(`请输入确认文案「${FINANCE_CLEAR_CONFIRM_TEXT}」`);
  }
  const explicit = process.env.ALLOW_FINANCE_DATA_CLEAR === 'true';
  const vercelEnv = String(process.env.VERCEL_ENV || '').toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const allowed =
    explicit ||
    vercelEnv === 'preview' ||
    vercelEnv === 'development' ||
    nodeEnv !== 'production';
  if (!allowed) {
    throw new ForbiddenException('生产环境禁止一键清空，请在 Preview/测试环境操作或设置 ALLOW_FINANCE_DATA_CLEAR');
  }
}
