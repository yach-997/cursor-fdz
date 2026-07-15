import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('首页首次请求期间使用骨架屏，不把初始 0 和空任务误当成真实数据', async () => {
  const home = await source('src/pages/home/index.tsx');

  assert.match(home, /useCachedResource\s*\(/);
  assert.match(home, /loading\s*\|\|\s*data\s*===\s*undefined\s*\?\s*\([\s\S]*?home-stats--loading/);
  assert.match(home, /loading\s*\?\s*\([\s\S]*?mobile-list-skeleton[\s\S]*?:\s*tasks\.length\s*===\s*0/);
});

test('任务页首次请求期间使用骨架屏，空态只能在请求结束后出现', async () => {
  const tasks = await source('src/pages/tasks/index.tsx');

  assert.match(tasks, /useCachedResource\s*\(/);
  assert.match(tasks, /loading\s*\?\s*\([\s\S]*?mobile-list-skeleton[\s\S]*?:\s*list\.length\s*===\s*0/);
});

test('我的页面首次请求期间使用统计骨架屏，不闪现“暂无数据”', async () => {
  const my = await source('src/pages/my/index.tsx');

  assert.match(my, /useCachedResource<InspectorSummary>\s*\(/);
  assert.match(my, /loading\s*\?\s*\([\s\S]*?mobile-summary-skeleton[\s\S]*?:\s*month\s*\?/);
});

test('三个页签缓存按账号、站点及筛选条件隔离', async () => {
  const keys = await source('src/utils/mobileCacheKeys.ts');

  assert.match(keys, /homeTasks:[\s\S]*userId[\s\S]*siteId/);
  assert.match(keys, /taskList:[\s\S]*userId[\s\S]*siteId[\s\S]*filters/);
  assert.match(keys, /inspectorSummary:[\s\S]*userId[\s\S]*siteId/);
});

test('底部导航预取首页、任务和我的数据，切换页签时可直接命中缓存', async () => {
  const layout = await source('src/layouts/TabLayout.tsx');

  assert.match(layout, /prefetchResource\s*\([\s\S]*mobileCacheKeys\.homeTasks/);
  assert.match(layout, /prefetchResource\s*\([\s\S]*mobileCacheKeys\.taskList/);
  assert.match(layout, /prefetchResource\s*\([\s\S]*mobileCacheKeys\.inspectorSummary/);
});

test('缓存采用先显示最近成功数据、再静默刷新的策略', async () => {
  const cache = await source('src/utils/useCachedResource.ts');

  assert.match(cache, /const memoryCache = new Map/);
  assert.match(cache, /sessionStorage\.getItem/);
  assert.match(cache, /setLoading\(cached === undefined\)/);
  assert.match(cache, /setRefreshing\(cached !== undefined\)/);
});
