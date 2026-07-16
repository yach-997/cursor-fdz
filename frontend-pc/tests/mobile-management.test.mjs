import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('管理端手机布局必须保留完整内容和可滑动表格', () => {
  const globalCss = read('../src/index.css');
  const layoutCss = read('../src/layouts/basic-layout.css');

  assert.match(globalCss, /width:\s*calc\(100vw - 16px\)\s*!important/);
  assert.match(globalCss, /max-height:\s*calc\(100dvh - 16px\)/);
  assert.match(globalCss, /\.ant-table-content\s*>\s*table\s*\{[\s\S]*min-width:\s*max-content/);
  assert.match(globalCss, /\.ant-drawer \.ant-drawer-content-wrapper[\s\S]*max-width:\s*100vw/);
  assert.match(layoutCss, /\.app-content__surface[\s\S]*overflow-x:\s*hidden/);
  assert.match(layoutCss, /\.mobile-drawer \.ant-drawer-content-wrapper/);
});

test('主要管理页表格必须声明横向滚动', () => {
  const pages = [
    '../src/pages/audit/index.tsx',
    '../src/pages/records/index.tsx',
    '../src/pages/alerts/index.tsx',
    '../src/pages/analysis/index.tsx',
    '../src/pages/templates/index.tsx',
    '../src/pages/dashboard/index.tsx',
    '../src/pages/sites/index.tsx',
    '../src/pages/users/index.tsx',
    '../src/pages/devices/index.tsx',
    '../src/pages/tasks/index.tsx',
  ];

  for (const page of pages) {
    assert.match(read(page), /scroll=\{\{\s*x:/, `${page} 缺少手机横向滚动配置`);
  }
});
