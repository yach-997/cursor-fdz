import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('费用结算中心独立注册路由和一级菜单', () => {
  const router = read('src/router/index.tsx'),
    menus = read('src/router/menus.ts');
  for (const route of ['finance/dashboard', 'finance/cases', 'finance/po-orders', 'finance/prices'])
    assert.match(router, new RegExp(route.replace('/', '\\/')));
  assert.match(menus, /费用结算中心/);
});

test('导入组件必须先预览再确认入库', () => {
  const dialog = read('src/pages/finance/components/ImportDialog.tsx'),
    api = read('src/api/finance.ts');
  assert.match(dialog, /解析预览/);
  assert.match(dialog, /确认入库/);
  assert.match(api, /preview:\s*String\(preview\)/);
});

test('费用页面保留移动端横向滚动与响应式布局', () => {
  const css = read('src/pages/finance/finance.css');
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
  assert.match(css, /overflow-x:\s*auto/);
  for (const file of [
    'src/pages/finance/cases/index.tsx',
    'src/pages/finance/po-orders/index.tsx',
    'src/pages/finance/prices/index.tsx',
  ])
    assert.match(read(file), /scroll=\{\{\s*x:/);
});

test('条目映射支持人工维护、系统建议和保存后重算', () => {
  const dialog = read('src/pages/finance/prices/ItemMappingDialog.tsx'),
    api = read('src/api/finance.ts');
  assert.match(dialog, /PO 条目映射维护/);
  assert.match(dialog, /系统建议/);
  assert.match(dialog, /保存并重算/);
  assert.match(api, /prices\/mappings\/recalculate/);
  assert.match(api, /saveItemPriceMapping/);
});

test('PO 管理支持反向生成案例并完成匹配', () => {
  const page = read('src/pages/finance/po-orders/index.tsx'),
    api = read('src/api/finance.ts');
  assert.match(page, /从 PO 生成案例并匹配/);
  assert.match(page, /待结算审核/);
  assert.match(api, /po-orders\/generate-cases/);
});
