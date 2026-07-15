import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('手机端任务、报告与设备类型都有中文兜底', async () => {
  const labels = await source('src/utils/displayLabels.ts');
  const detail = await source('src/pages/tasks/detail.tsx');
  const report = await source('src/pages/report/index.tsx');

  assert.match(labels, /string_inverter:\s*'组串式逆变器'/);
  assert.match(detail, /未知设备类型/);
  assert.match(detail, /未知状态/);
  assert.match(report, /RECORD_STATUS_LABEL/);
});

test('手机端英文网络与图片异常统一转换为中文提示', async () => {
  const labels = await source('src/utils/displayLabels.ts');
  const request = await source('src/utils/request.ts');

  assert.match(labels, /image to composite\|sharp/i);
  assert.match(labels, /network error\|failed to fetch/i);
  assert.match(request, /chineseErrorMessage/);
});
