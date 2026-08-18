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

test('定位按钮保持动作名称，上传改为点加号后选拍照或相册', async () => {
  const inspection = await source('src/pages/inspection/index.tsx');

  assert.match(inspection, /ActionSheet/);
  assert.match(inspection, /从相册选择（可多选）/);
  assert.match(inspection, /name:\s*'拍照'/);
  assert.doesNotMatch(inspection, /定位通过后选择|定位通过后拍照/);
  assert.match(inspection, /inspection-photo-placeholder is-clickable/);
  assert.match(inspection, /aria-label=\"添加照片\"/);
  assert.doesNotMatch(inspection, /继续添加|更换/);
});
