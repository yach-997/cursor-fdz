require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ExcelParserService } = require('../dist/modules/finance/services/excel-parser.service');
const {
  isIgnoredItem,
  pickMappedPrice,
} = require('../dist/modules/finance/services/item-matcher');

function cents(value) {
  return Math.round(Number(value) * 100);
}
function aggregate(orders, field) {
  const result = {};
  for (const order of orders) {
    const key = order[field];
    result[key] ||= { count: 0, cents: 0 };
    result[key].count += 1;
    result[key].cents += cents(order.poTotalAmount);
  }
  return result;
}

async function main() {
  const sampleDir = path.resolve(__dirname, '../../docs/samples');
  const poName = fs
    .readdirSync(sampleDir)
    .find((name) => name.startsWith('PO') && name.endsWith('.xlsx'));
  const priceName = fs.readdirSync(sampleDir).find((name) => name === '附件1.xlsx');
  assert.ok(poName, '缺少真实 PO 样本');
  assert.ok(priceName, '缺少附件1价格参考文件');
  const parser = new ExcelParserService();
  const parsed = await parser.parsePo(fs.readFileSync(path.join(sampleDir, poName)));
  assert.equal(parsed.orders.length, 232, 'PO 数必须为 232');
  assert.equal(parsed.sourceItemRows, 506, '原始 PO 条目行必须为 506');
  // 236 行同时含专用和通用条目，按规格拆分后应为 742 条标准化明细。
  assert.equal(parsed.normalizedItemCount, 742, '标准化 PO 条目数必须为 742');
  assert.equal(parsed.failures.length, 0);
  assert.equal(
    parsed.orders.reduce((sum, item) => sum + cents(item.poTotalAmount), 0),
    50749525,
  );
  assert.deepEqual(aggregate(parsed.orders, 'province'), {
    广西: { count: 36, cents: 6818215 },
    广东: { count: 63, cents: 15318731 },
    福建: { count: 12, cents: 7141505 },
    海南: { count: 23, cents: 2432850 },
    云南: { count: 98, cents: 19038224 },
  });
  assert.deepEqual(aggregate(parsed.orders, 'demandType'), {
    故障恢复: { count: 149, cents: 21573782 },
    整改: { count: 20, cents: 17314942 },
    交付: { count: 31, cents: 7918944 },
    维护: { count: 32, cents: 3941857 },
  });
  const example = parsed.orders.find((item) => item.poNo === 'PO2607110106');
  assert.equal(example.gspCaseNo, 'RW2607080204');
  assert.equal(example.items.length, 5, '真实样本为1条专用+4条通用');
  const priceResult = await parser.parseSettlePrices(
    fs.readFileSync(path.join(sampleDir, priceName)),
  );
  assert.ok(priceResult.prices.length > 1000, '附件1应解析出 BOQ 场景价、综合工时价及报价单通用价');
  for (const price of priceResult.prices.filter((item) => item.workHours).slice(0, 4)) {
    assert.equal(cents(price.unitPrice), cents(price.workHours * 81.25 * 0.99));
  }

  // 数据库唯一维度相同时后导入记录覆盖前一记录，验收核算必须复现真实取价快照。
  const priceSnapshotByDimension = new Map();
  for (const price of priceResult.prices) {
    priceSnapshotByDimension.set(
      [price.itemCode, price.productModel || '', price.scene || ''].join('|'),
      price,
    );
  }
  const priceSnapshot = [...priceSnapshotByDimension.values()].map((price) => ({
    ...price,
    priceType: 'settle',
    status: 'active',
    effectiveDate: '2026-07-01',
  }));
  assert.ok(priceSnapshot.length > 700);
  let pricedItems = 0;
  let pendingPrice = 0;
  let ignoredItems = 0;
  let incomeCents = 0;
  for (const order of parsed.orders) {
    const contextItemNames = order.items
      .filter((item) => item.itemCategory === 'special' && !isIgnoredItem(item.itemCode))
      .map((item) => item.itemCode);
    for (const item of order.items) {
      if (isIgnoredItem(item.itemCode)) {
        ignoredItems += 1;
        continue;
      }
      const price = pickMappedPrice(
        priceSnapshot,
        item.itemCode,
        order.projectScene,
        order.productModel,
        [],
        contextItemNames,
        order.demandType,
      )?.price;
      if (!price) pendingPrice += 1;
      else {
        pricedItems += 1;
        const lineCents = cents(item.qty * price.unitPrice);
        incomeCents += lineCents;
      }
    }
  }
  assert.equal(new Set(parsed.orders.map((item) => item.gspCaseNo)).size, 232);
  const poTotalCents = 50749525;
  const varianceRate = Math.abs(incomeCents - poTotalCents) / poTotalCents;
  assert.equal(pricedItems, 700, '应完成 700 条有效条目定价');
  assert.equal(ignoredItems, 42, '无/自定义占位条目应单独忽略');
  assert.equal(pendingPrice, 0, '除占位废条目外，真实 PO 条目都应完成定价');
  assert.equal(incomeCents, 50294926, '已定价核算收入应为 502,949.26 元');
  assert.ok(varianceRate < 0.01, '已定价核算收入与 PO 总金额偏差必须小于 1%');
  console.log(
    `finance acceptance passed: ${parsed.orders.length} PO matched / ${pricedItems} priced / ${pendingPrice} pending / income ${(incomeCents / 100).toFixed(2)}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
