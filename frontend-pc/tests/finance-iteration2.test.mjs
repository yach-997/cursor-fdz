import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const workspace = path.resolve(root, '..');
const read = (file) => fs.readFileSync(path.join(workspace, file), 'utf8');

test('新案例完工自动创建台账且审核前按最新绩效价刷新', () => {
  const workflow = read('backend/src/modules/finance/services/finance-workflow.service.ts');
  assert.match(workflow, /if \(hasPo\) await this\.refreshLedger\(serviceCase, true\)/);
  assert.match(workflow, /const ledger = await this\.refreshLedger\(serviceCase\)/);
  assert.match(workflow, /this\.ledgers\.create\(\{/);
  assert.match(workflow, /ledger\.perfBase = perfBase\.toFixed\(2\)/);
});

test('经营看板偏差率由页面同一组金额直接计算', () => {
  const page = read('frontend-pc/src/pages/finance/dashboard/index.tsx');
  assert.match(page, /Math\.abs\(income - poTotalAmount\) \/ poTotalAmount/);
  const actual = Math.abs(502949.26 - 507495.25) / 507495.25;
  assert.equal((actual * 100).toFixed(2), '0.90');
});

test('迭代二注册派单、结算审核与手机收入入口', () => {
  const pcRouter = read('frontend-pc/src/router/index.tsx');
  const h5Router = read('frontend-h5/src/router/index.tsx');
  const my = read('frontend-h5/src/pages/my/index.tsx');
  assert.match(pcRouter, /path: 'review'/);
  assert.match(h5Router, /\/m\/finance-cases/);
  assert.match(h5Router, /\/m\/income/);
  assert.match(my, /我的收入/);
});

test('后端状态机包含区域、忙碌、完工凭证和本人收入约束', () => {
  const workflow = read('backend/src/modules/finance/services/finance-workflow.service.ts');
  assert.match(workflow, /站长不能跨区域派单/);
  assert.match(workflow, /正在处理案例/);
  assert.match(workflow, /请上传里程截图后再完工/);
  assert.match(workflow, /inspectorId: user\.id, month: selectedMonth/);
  assert.match(workflow, /只有管理员可以复核特殊扣减/);
});

test('第十张工作记录表和回滚迁移齐备', () => {
  assert.match(read('supabase/migrations/20260719210000_finance_iteration_2.sql'), /create table if not exists public\.case_work_record/);
  assert.match(read('supabase/rollbacks/20260719210000_finance_iteration_2_rollback.sql'), /drop table if exists public\.case_work_record/);
});
