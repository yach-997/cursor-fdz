import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const workspace = path.resolve(root, '..');
const read = (file) => fs.readFileSync(path.join(workspace, file), 'utf8');

test('iteration 3 registers assessment and monthly settlement pages and APIs', () => {
  const router = read('frontend-pc/src/router/index.tsx');
  const api = read('frontend-pc/src/api/finance.ts');
  const layout = read('frontend-pc/src/pages/finance/FinanceLayout.tsx');
  assert.match(router, /path: 'assessment'/);
  assert.match(router, /path: 'monthly'/);
  assert.match(api, /monthly-settlements\/\$\{month\}\/export/);
  assert.match(layout, /完整结算闭环/);
});

test('settlement service implements weighted score, ranking, locking and role-based profit visibility', () => {
  const service = read('backend/src/modules/finance/services/finance-settlement.service.ts');
  const query = read('backend/src/modules/finance/services/finance-query.service.ts');
  assert.match(service, /dto\.internalScore \* 0\.6 \+ dto\.sungrowScore \* 0\.4/);
  assert.match(service, /index < quota \? '优秀'/);
  assert.match(service, /row\.status = 'locked'/);
  assert.match(service, /row\?\.status === 'locked'/);
  assert.match(query, /user\.role === UserRole\.SUPER_ADMIN/);
  assert.match(query, /grossProfit/);
});

test('iteration 3 migration and rollback are complete and money fields keep two decimals', () => {
  const migration = read('supabase/migrations/20260719230000_finance_iteration_3.sql');
  const rollback = read('supabase/rollbacks/20260719230000_finance_iteration_3.rollback.sql');
  assert.match(migration, /create table if not exists public\.assessment/);
  assert.match(migration, /create table if not exists public\.monthly_settlement/);
  assert.ok((migration.match(/numeric\(12,2\)/g) || []).length >= 9);
  assert.match(rollback, /drop table if exists public\.monthly_settlement/);
  assert.match(rollback, /drop table if exists public\.assessment/);
});

test('mobile income page displays assessment, monthly settlement and locked status', () => {
  const page = read('frontend-h5/src/pages/finance/income.tsx');
  const api = read('frontend-h5/src/api/finance.ts');
  assert.match(page, /本月考核与补助/);
  assert.match(page, /月度结算金额/);
  assert.match(page, /本月已锁定/);
  assert.match(api, /assessment/);
  assert.match(api, /monthly/);
});

test('monthly settlement list exposes only safe user fields', () => {
  const service = read('backend/src/modules/finance/services/finance-settlement.service.ts');
  const mapper = service.slice(service.indexOf('async listMonthly'), service.indexOf('async correctMonthly'));
  assert.match(mapper, /username: person\.username/);
  assert.match(mapper, /realName: person\.realName/);
  assert.doesNotMatch(mapper, /password/);
});
