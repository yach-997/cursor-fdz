import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('首页设备类型和预警级别必须经过中文映射', async () => {
  const dashboard = await source('src/pages/dashboard/index.tsx');
  const alerts = await source('src/pages/alerts/index.tsx');

  assert.match(dashboard, /DEVICE_TYPE_LABEL\[value/);
  assert.doesNotMatch(dashboard, /render:\s*\([^)]*\)\s*=>\s*value\b/);
  assert.match(alerts, /ALERT_SEVERITY_LABEL\[v\]/);
  assert.doesNotMatch(alerts, />\{v\}<\/Tag>/);
});

test('入口和登录页不再展示英文产品标语', async () => {
  const portal = await source('src/pages/portal/index.tsx');
  const login = await source('src/pages/login/index.tsx');

  assert.doesNotMatch(portal, /SMART ENERGY INSPECTION/);
  assert.doesNotMatch(login, /Smart Energy Operations/);
  assert.match(portal, /电脑管理后台/);
  assert.match(portal, /手机巡检端/);
});

test('接口英文异常统一转换为中文提示', async () => {
  const labels = await source('src/utils/displayLabels.ts');
  const request = await source('src/utils/request.ts');

  assert.match(labels, /network error\|failed to fetch/i);
  assert.match(labels, /request failed with status code/i);
  assert.match(request, /chineseErrorMessage/);
});

test('审核页同时展示 AI 结论与工程师现场结论', async () => {
  const audit = await source('src/pages/audit/index.tsx');

  assert.match(audit, /AI 不合格 \{row\.aiSummary\?\.fail\} 项/);
  assert.match(audit, /AI 异常 \{row\.aiSummary\?\.error\} 项/);
  assert.match(audit, /工程师现场确认/);
  assert.match(audit, /工程师未确认/);
});
