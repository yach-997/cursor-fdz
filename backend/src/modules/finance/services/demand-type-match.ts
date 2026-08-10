import { IsNull, Repository } from 'typeorm';
import {
  InspectionTemplate,
  ServiceCase,
  TemplateEntry,
  TemplateProductLine,
} from '../../../entities';

export type DemandMatchWarningCode =
  | 'service_type_not_found'
  | 'product_line_not_found'
  | 'product_line_empty';

export type DemandMatchWarning = {
  row?: number;
  gspCaseNo?: string;
  code: DemandMatchWarningCode;
  message: string;
};

/** 服务类型：仅精确匹配（全局同名优先） */
export async function findDemandTypeTemplate(
  templates: Repository<InspectionTemplate>,
  demandType: string | null | undefined,
): Promise<InspectionTemplate | null> {
  const demand = String(demandType || '').trim();
  if (!demand) return null;
  const exactGlobal = await templates.findOne({
    where: { name: demand, isGlobal: true, siteId: IsNull() },
  });
  if (exactGlobal) return exactGlobal;
  return templates.findOne({ where: { name: demand } });
}

/** 产品线：仅精确匹配名称 */
export function matchProductLine(
  template: InspectionTemplate,
  productLine: string | null | undefined,
): TemplateProductLine | null {
  const lines = Array.isArray(template.productLines) ? template.productLines : [];
  if (!lines.length) return null;
  const name = String(productLine || '').trim();
  if (!name) return null;
  return lines.find((p) => String(p.name || '').trim() === name) || null;
}

/** 解析案例实际使用的检查条目：有产品线用产品线，否则用通用 entries */
export function resolveTemplateEntries(
  template: InspectionTemplate,
  productLine: string | null | undefined,
): TemplateEntry[] {
  const lines = Array.isArray(template.productLines) ? template.productLines : [];
  if (lines.length) {
    const matched = matchProductLine(template, productLine);
    if (matched?.entries?.length) return matched.entries;
    return [];
  }
  return Array.isArray(template.entries) ? template.entries : [];
}

/** 评估单条案例的匹配缺口（不修改数据） */
export function inspectDemandMatch(
  serviceCase: ServiceCase,
  template: InspectionTemplate | null,
): DemandMatchWarning[] {
  const warnings: DemandMatchWarning[] = [];
  const demand = String(serviceCase.serviceType || '').trim();
  const productLine = String(serviceCase.productLine || '').trim();
  const gspCaseNo = serviceCase.gspCaseNo;

  if (demand && !template && !serviceCase.taskTemplateId) {
    warnings.push({
      gspCaseNo,
      code: 'service_type_not_found',
      message: `服务类型「${demand}」未在系统中精确匹配，请到「服务类型」新增同名类型（案例已导入，不阻断）`,
    });
    return warnings;
  }

  const tpl = template;
  if (!tpl) return warnings;

  const lines = Array.isArray(tpl.productLines) ? tpl.productLines : [];

  // 案例带来了产品线：无论模板是否已配产品线，都必须能精确命中
  if (productLine) {
    if (!matchProductLine(tpl, productLine)) {
      warnings.push({
        gspCaseNo,
        code: 'product_line_not_found',
        message: lines.length
          ? `产品线「${productLine}」在服务类型「${tpl.name}」下不存在，请到「服务类型」新增同名产品线（案例已导入，不阻断）`
          : `服务类型「${tpl.name}」尚未配置产品线，案例需要「${productLine}」，请到「服务类型」新增同名产品线（案例已导入，不阻断）`,
      });
    }
    return warnings;
  }

  if (lines.length) {
    warnings.push({
      gspCaseNo,
      code: 'product_line_empty',
      message: `服务类型「${tpl.name}」已配置产品线，但案例未填写产品线（案例已导入，不阻断）`,
    });
  }

  return warnings;
}

/**
 * 案例尚未设类型时，按 serviceType 精确套用模板；
 * 产品线仅在精确匹配时视为已就绪（原文始终保留，便于补配置后自动对上）。
 */
export async function applyDemandTypeIfMissing(
  cases: Repository<ServiceCase>,
  templates: Repository<InspectionTemplate>,
  serviceCase: ServiceCase,
): Promise<{ changed: boolean; warnings: DemandMatchWarning[] }> {
  let changed = false;
  let tpl: InspectionTemplate | null = null;

  if (!serviceCase.taskTemplateId) {
    tpl = await findDemandTypeTemplate(templates, serviceCase.serviceType);
    if (tpl) {
      serviceCase.taskTemplateId = tpl.id;
      serviceCase.taskType = String(tpl.name || '').slice(0, 128) || tpl.id;
      serviceCase.unitLabel = '台';
      serviceCase.expenseEnabled = true;
      if (!serviceCase.assignMode) serviceCase.assignMode = 'single';
      if (serviceCase.assignMode === 'single') serviceCase.plannedUnits = 1;
      changed = true;
    }
  } else {
    tpl = await templates.findOne({ where: { id: serviceCase.taskTemplateId } });
  }

  // 已绑模板但服务类型名变更时，不自动改绑；产品线仅精确命中时规范化（通常无需改名）
  if (tpl && serviceCase.productLine) {
    const matched = matchProductLine(tpl, serviceCase.productLine);
    if (matched && matched.name !== serviceCase.productLine) {
      serviceCase.productLine = matched.name;
      changed = true;
    }
  }

  if (changed) await cases.save(serviceCase);

  const warnings = inspectDemandMatch(serviceCase, tpl);
  return { changed, warnings };
}

export async function applyDemandTypeForCases(
  cases: Repository<ServiceCase>,
  templates: Repository<InspectionTemplate>,
  list: ServiceCase[],
): Promise<{ matched: number; warnings: DemandMatchWarning[] }> {
  let matched = 0;
  const warnings: DemandMatchWarning[] = [];
  for (const item of list) {
    const result = await applyDemandTypeIfMissing(cases, templates, item);
    if (result.changed) matched += 1;
    for (const w of result.warnings) {
      warnings.push({
        ...w,
        gspCaseNo: w.gspCaseNo || item.gspCaseNo,
      });
    }
  }
  return { matched, warnings };
}

/** 服务类型新建/改产品线后：按同名服务类型或已绑模板精确重匹配 */
export async function rematchCasesForTemplate(
  cases: Repository<ServiceCase>,
  templates: Repository<InspectionTemplate>,
  template: InspectionTemplate,
): Promise<number> {
  const name = String(template.name || '').trim();
  if (!name && !template.id) return 0;
  const qb = cases.createQueryBuilder('c');
  if (template.id) {
    qb.where('c.task_template_id = :id', { id: template.id });
  }
  if (name) {
    if (template.id) {
      qb.orWhere('TRIM(COALESCE(c.service_type, \'\')) = :name', { name });
    } else {
      qb.where('TRIM(COALESCE(c.service_type, \'\')) = :name', { name });
    }
  }
  const list = await qb.getMany();
  if (!list.length) return 0;
  const { matched } = await applyDemandTypeForCases(cases, templates, list);
  return matched;
}
