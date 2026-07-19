import { PriceLibrary } from '../../../entities';

export interface ItemCodeMappingLike {
  sourceItemName: string;
  targetItemCode: string;
}

const ACTIONS = [
  '整机更换',
  '产品预防性维护',
  '一级故障恢复',
  '二级故障恢复',
  '三级故障恢复',
  '四级故障恢复',
  '产品调试',
  '软件升级',
  '器件维护',
  '硬件维护',
  '通讯维护',
];

export function normalizeItemName(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/运维/g, '维护')
    .replace(/维修/g, '')
    .replace(/整改/g, '')
    .replace(/产品/g, '')
    .replace(/系列/g, '')
    .replace(/[\s_\-*—–/\\+，、,。.·:：]/g, '')
    .trim();
}

export function isIgnoredItem(value: string): boolean {
  return ['无', '自定义'].includes(String(value || '').trim());
}

export function completeSourceItemName(source: string, productModel: string | null): string {
  if (!productModel || !/^整机更换[_*\-]?维修[（(]≤?3台场景[）)]$/i.test(source)) return source;
  return `整机更换_${productModel}_维修（≤3台场景）`;
}

function modelTokens(value: string): string[] {
  return [
    ...new Set(
      String(value || '')
        .toUpperCase()
        .match(/(?:SG|ST|PT|EMU|CDC|IDC)\d+(?:\.\d+)?[A-Z-]*/g) || [],
    ),
  ];
}

function actionOf(value: string): string | null {
  return ACTIONS.find((action) => value.includes(action)) || null;
}

export function builtinTargetCode(
  source: string,
  targetCodes: string[],
): {
  targetItemCode: string;
  confidence: number;
} | null {
  const directAliases: Array<[RegExp, RegExp]> = [
    [/^在途\d*$/i, /^其他[_*\-]?在途$/i],
    [/^入离场$/i, /^其他[_*\-]?入场$/i],
    [
      /^整机更换(?:[_*\-].+)?[_*\-](?:维修|整改)(?:（.*）|\(.*\))?$/i,
      /^整机更换[_*\-]?整改、维修$/i,
    ],
    [/^辅助设备租赁[_*\-]?吊车$/i, /^BESS吊装$/i],
  ];
  for (const [sourceRule, targetRule] of directAliases) {
    if (!sourceRule.test(source)) continue;
    const target = targetCodes.find((code) => targetRule.test(code));
    if (target) return { targetItemCode: target, confidence: 0.99 };
  }

  const normalized = normalizeItemName(source);
  const exact = targetCodes.filter((code) => normalizeItemName(code) === normalized);
  const rawExact = exact.find((code) => code === source);
  if (rawExact) return { targetItemCode: rawExact, confidence: 1 };
  const sourcePrefix = source.split(/[_*\-]/)[0];
  const sameStyle = exact.filter((code) => code.split(/[_*\-]/)[0] === sourcePrefix);
  if (sameStyle.length === 1) return { targetItemCode: sameStyle[0], confidence: 0.99 };
  if (exact.length === 1) return { targetItemCode: exact[0], confidence: 1 };

  const sourceAction = actionOf(source);
  const sourceModels = modelTokens(source);
  if (!sourceAction || !sourceModels.length) return null;
  const candidates = targetCodes.filter((code) => {
    if (actionOf(code) !== sourceAction) return false;
    const targets = modelTokens(code);
    return sourceModels.some((model) => targets.includes(model));
  });
  const styledCandidates = candidates.filter((code) => code.split(/[_*\-]/)[0] === sourcePrefix);
  const selected =
    styledCandidates.length === 1
      ? styledCandidates[0]
      : candidates.length === 1
        ? candidates[0]
        : null;
  return selected ? { targetItemCode: selected, confidence: 0.95 } : null;
}

export function resolveTargetCode(
  source: string,
  targetCodes: string[],
  mappings: ItemCodeMappingLike[],
): { targetItemCode: string; confidence: number; mappingType: 'manual' | 'builtin' } | null {
  const manual = mappings.find((mapping) => mapping.sourceItemName === source);
  if (manual)
    return { targetItemCode: manual.targetItemCode, confidence: 1, mappingType: 'manual' };
  const builtin = builtinTargetCode(source, targetCodes);
  return builtin ? { ...builtin, mappingType: 'builtin' } : null;
}

export function pickMappedPrice(
  prices: PriceLibrary[],
  sourceItemName: string,
  scene: string | null,
  model: string | null,
  mappings: ItemCodeMappingLike[],
  contextItemNames: string[] = [],
  demandType: string | null = null,
): { price: PriceLibrary; targetItemCode: string; mappingType: 'manual' | 'builtin' } | null {
  const settlePrices = prices.filter(
    (price) => price.priceType === 'settle' && price.status === 'active',
  );
  const general = pickGeneralPrice(
    settlePrices,
    sourceItemName,
    model,
    contextItemNames,
    demandType,
  );
  if (general) return { price: general, targetItemCode: general.itemCode, mappingType: 'builtin' };
  const completedSource = completeSourceItemName(sourceItemName, model);
  const targetCodes = [...new Set(settlePrices.map((price) => price.itemCode))];
  const match =
    resolveTargetCode(sourceItemName, targetCodes, mappings) ||
    resolveTargetCode(completedSource, targetCodes, mappings);
  if (!match) return null;
  const candidates = settlePrices
    .filter(
      (price) =>
        price.itemCode === match.targetItemCode &&
        (!price.productModel || price.productModel === model) &&
        (!price.scene || price.scene === scene),
    )
    .sort(
      (left, right) =>
        Number(Boolean(right.scene)) - Number(Boolean(left.scene)) ||
        Number(Boolean(right.productModel)) - Number(Boolean(left.productModel)) ||
        right.effectiveDate.localeCompare(left.effectiveDate),
    );
  return candidates[0]
    ? { price: candidates[0], targetItemCode: match.targetItemCode, mappingType: match.mappingType }
    : null;
}

function generalKind(source: string): '在途' | '入离场' | '搬运' | null {
  if (/^在途\d*$/i.test(source)) return '在途';
  if (/^入离场$/i.test(source)) return '入离场';
  if (/^搬运\d*$/i.test(source)) return '搬运';
  return null;
}

function quotedGeneralCode(source: string): string | null {
  const value = String(source || '').trim();
  if (/^在途\d*$/i.test(value)) return '通用_在途1';
  if (/^入离场$/i.test(value)) return '通用_入离场';
  if (/^住宿$/i.test(value)) return '通用_住宿';
  if (/^通用$/i.test(value)) return '通用_通用';
  if (/^搬运1$/i.test(value)) return '通用_搬运1';
  if (/^搬运2$/i.test(value)) return '通用_搬运2';
  if (/辅助设备租赁[-_]?叉车/i.test(value)) return '通用_辅助设备租赁-叉车';
  if (/辅助设备租赁[-_]?吊车/i.test(value)) return '通用_辅助设备租赁-吊车';
  return null;
}

function modelScore(sourceModel: string | null, targetModel: string): number {
  const source = normalizeItemName(sourceModel || '');
  const target = normalizeItemName(targetModel);
  if (!source) return 0;
  if (source === target || source.includes(target) || target.includes(source)) return 40;
  if (/SG(?:225|250)/.test(source) && /SG320/.test(target)) return 32;
  if (/SG110/.test(source) && /SG110/.test(target)) return 36;
  if (source.includes('集中式历史') && /SG3125/.test(target)) return 30;
  if (source.includes('地面组串') && /SG320/.test(target)) return 28;
  return 0;
}

function pickGeneralPrice(
  prices: PriceLibrary[],
  sourceItemName: string,
  productModel: string | null,
  contextItemNames: string[],
  demandType: string | null,
): PriceLibrary | null {
  const quoteCode = quotedGeneralCode(sourceItemName);
  if (quoteCode) {
    const quote = prices.find((price) => price.itemCode === quoteCode);
    if (quote) return quote;
  }
  const kind = generalKind(sourceItemName);
  if (!kind) return null;
  const context = `${contextItemNames.join(' ')} ${demandType || ''}`;
  const actionWords = [
    '整机更换',
    '一级故障恢复',
    '二级故障恢复',
    '三级故障恢复',
    '四级故障恢复',
    '预防性维护',
    '巡检',
    '交付',
    '部件更换',
  ];
  const scored = prices
    .filter((price) => price.itemCode.startsWith(`通用_${kind}::`))
    .map((price) => {
      const parts = price.itemCode.split('::');
      const targetModel = parts[1] || '';
      const targetContext = `${parts.slice(2, 5).join(' ')} ${price.itemDesc || ''}`;
      let score = modelScore(productModel, targetModel);
      if (!score) return { price, score: -1 };
      for (const action of actionWords) {
        if (context.includes(action) && targetContext.includes(action)) score += 25;
      }
      if (demandType && targetContext.includes(demandType)) score += 12;
      const sourceSmallBatch = /≤\s*3台|3台场景/.test(context);
      const targetSmallBatch = /≤\s*3台/.test(targetContext);
      const targetLargeBatch = />\s*3台|＞\s*3台/.test(targetContext);
      if (sourceSmallBatch && targetSmallBatch) score += 35;
      if (sourceSmallBatch && targetLargeBatch) score -= 50;
      return { price, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score || Number(right.price.unitPrice) - Number(left.price.unitPrice),
    );
  return scored[0]?.price || null;
}
