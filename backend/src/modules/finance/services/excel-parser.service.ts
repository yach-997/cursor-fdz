import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface ParsedPoItem {
  sourceRow: number;
  itemCategory: 'special' | 'general';
  itemCode: string;
  itemName: string;
  itemDesc: string | null;
  unit: string | null;
  qty: number;
}

export interface ParsedPoOrder {
  poNo: string;
  gspCaseNo: string;
  poTotalAmount: number;
  demandDate: string | null;
  demander: string | null;
  demandType: string | null;
  productLine: string | null;
  productModel: string | null;
  productQty: number | null;
  faultPhenomenon: string | null;
  faultLevel: string | null;
  durationReq: string | null;
  demandDesc: string | null;
  projectArea: string | null;
  projectCountry: string | null;
  projectRegion: string | null;
  province: string | null;
  projectName: string | null;
  projectScene: string | null;
  submitter: string | null;
  dingtalkCreatedAt: Date | null;
  dingtalkUpdatedAt: Date | null;
  items: ParsedPoItem[];
}

export interface ParsedGspCase {
  sourceRow: number;
  gspCaseNo: string;
  projectName: string;
  serviceType: string | null;
  creator: string | null;
  province: string | null;
  city: string | null;
  siteDesc: string | null;
  region: 'south_china' | 'yunnan';
  warning?: string;
}

export interface ParsedSettlePrice {
  sourceRow: number;
  itemCode: string;
  itemName: string;
  itemDesc: string | null;
  unit: string | null;
  productModel: string | null;
  scene: string | null;
  workHours: number | null;
  unitPrice: number;
}

export interface ParsedPerfPrice {
  sourceRow: number;
  itemCode: string;
  itemName: string;
  itemDesc: string | null;
  unit: string | null;
  productModel: string | null;
  scene: string | null;
  region: string | null;
  coopType: string | null;
  workHours: number | null;
  unitPrice: number;
  effectiveDate: string | null;
  status: 'active' | 'inactive';
}

// 《服务报价单-中邮建技术有限公司-0630.pdf》“通用”部分的最终应答单价。
// 这几项不是 BOQ 的现场工时价，不能再按 工时 × 81.25 × 0.99 推导。
const QUOTE_GENERAL_PRICES: Array<{
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
}> = [
  { code: '通用_在途1', name: '在途1', unit: '次', unitPrice: 336.6 },
  { code: '通用_入离场', name: '入离场', unit: '次', unitPrice: 193.05 },
  { code: '通用_住宿', name: '住宿', unit: '次', unitPrice: 168.3 },
  { code: '通用_通用', name: '通用', unit: '次', unitPrice: 504.9 },
  { code: '通用_搬运1', name: '搬运1', unit: '次', unitPrice: 594 },
  { code: '通用_搬运2', name: '搬运2', unit: '台', unitPrice: 792 },
  { code: '通用_辅助设备租赁-叉车', name: '辅助设备租赁-叉车', unit: '次', unitPrice: 495 },
  { code: '通用_辅助设备租赁-吊车', name: '辅助设备租赁-吊车', unit: '次', unitPrice: 693 },
];

type QuoteScenePrices = Partial<Record<'平地' | '水上' | '山地' | '高原' | '屋顶' | '海上', number>>;

// 附件 1 技术平台 BOQ 未完整收录、但正式服务报价单中已有最终单价的条目。
const QUOTE_SUPPLEMENT_PRICES: Array<{
  code: string;
  unit: string;
  prices: QuoteScenePrices;
}> = [
  { code: '整机更换_维修（≤3台场景）', unit: '台', prices: { 平地: 386.1, 水上: 651.54, 山地: 632.24, 高原: 521.24, 屋顶: 603.28 } },
  { code: '整机更换_SG225HX_维修', unit: '台', prices: { 平地: 386.1, 水上: 651.54, 山地: 632.24, 高原: 521.24, 屋顶: 603.28 } },
  { code: '整机更换_SG250HX_维修', unit: '台', prices: { 平地: 386.1, 水上: 651.54, 山地: 632.24, 高原: 521.24, 屋顶: 603.28 } },
  { code: '维护_SG320/SG225_产品预防性维护(带电巡检）', unit: '台', prices: { 平地: 40.22, 水上: 60.33, 山地: 52.28, 高原: 54.3, 屋顶: 52.28 } },
  { code: '交付_光储产品_涉网试验', unit: '次', prices: { 平地: 504.9, 水上: 504.9, 山地: 504.9, 高原: 504.9, 屋顶: 504.9 } },
  { code: '维护_直流充电桩四级故障恢复', unit: '项', prices: { 平地: 160.88, 水上: 160.88, 山地: 160.88, 高原: 160.88, 屋顶: 160.88 } },
  { code: '维护_SG225HX_四级故障恢复', unit: '项', prices: { 平地: 160.88, 水上: 241.31, 山地: 209.14, 高原: 217.18, 屋顶: 241.31 } },
  { code: '维护_SG250HX_四级故障恢复', unit: '项', prices: { 平地: 160.88, 水上: 241.31, 山地: 209.14, 高原: 217.18, 屋顶: 241.31 } },
  { code: '维护_通讯箱_硬件维护', unit: '台', prices: { 平地: 40.22, 水上: 60.33, 山地: 48.26, 高原: 48.26, 屋顶: 48.26 } },
  { code: '维护_通讯箱_通讯维护', unit: '台', prices: { 平地: 60.33, 水上: 96.53, 山地: 80.44, 高原: 80.44, 屋顶: 80.44 } },
  { code: '维护_组串式软件升级_整改_(200MW以下,含200MW)', unit: '站', prices: { 平地: 804.38, 水上: 804.38, 山地: 804.38, 高原: 804.38, 屋顶: 804.38 } },
  { code: '维护_组串式软件升级_整改_(200MW以上）', unit: '站', prices: { 平地: 1287, 水上: 1287, 山地: 1287, 高原: 1287, 屋顶: 1287 } },
  { code: '整改_1+X更换进风口区域丝网板', unit: '单元', prices: { 平地: 20.11, 水上: 28.15, 山地: 24.13, 高原: 24.13 } },
  { code: '整改_电器件更换', unit: '项', prices: { 平地: 160.88, 水上: 160.88, 山地: 160.88, 高原: 160.88, 屋顶: 160.88 } },
  { code: '整改_EMU200_太阳花散热器', unit: '台', prices: { 平地: 24.13, 山地: 24.13, 高原: 24.13, 屋顶: 24.13 } },
  { code: '整改_EMU200_加装遮阳罩', unit: '台', prices: { 平地: 48.26, 水上: 48.26, 山地: 48.26, 高原: 48.26, 屋顶: 48.26 } },
  { code: '交付_CDC/IDC480~960+分体桩产品调试', unit: '台', prices: { 平地: 80.44, 水上: 80.44, 山地: 80.44, 高原: 80.44, 屋顶: 80.44 } },
  { code: '维护_分布式_整机更换（50KW以上及KTL系列机型）', unit: '台', prices: { 平地: 345.88, 水上: 449.65, 山地: 449.65, 高原: 449.65, 屋顶: 449.65 } },
  { code: '维护_集中式汇流箱_器件维护', unit: '台', prices: { 平地: 80.44, 水上: 160.88, 山地: 104.57, 高原: 104.57 } },
  { code: '维护_集中式历史产品_一级故障恢复', unit: '项', prices: { 平地: 643.5, 水上: 965.25, 山地: 836.55, 高原: 868.73 } },
  { code: '维护_集中式历史产品_四级故障恢复', unit: '项', prices: { 平地: 160.88, 水上: 241.31, 山地: 209.14, 高原: 217.18 } },
  { code: '整改_PT1.0系统_NTC更换', unit: 'PACK', prices: { 平地: 382.08, 水上: 382.08, 山地: 382.08, 高原: 382.08, 屋顶: 382.08 } },
  { code: '整改_数采软件升级_整改_(400MW以下，含400MW）', unit: '站', prices: { 平地: 321.75, 水上: 321.75, 山地: 321.75, 高原: 321.75, 屋顶: 321.75 } },
  { code: '维护_户用光伏_整机更换', unit: '台', prices: { 平地: 120.66, 水上: 120.66, 山地: 120.66, 高原: 120.66, 屋顶: 120.66 } },
  { code: '整改_SG320HX打开直通保护功能(400MW以上）', unit: '站', prices: { 平地: 965.25, 水上: 965.25, 山地: 965.25, 高原: 965.25, 屋顶: 965.25 } },
  { code: '整改_SG320HX-30替换SG320HX', unit: '台', prices: { 平地: 402.19, 水上: 667.63, 山地: 643.5, 高原: 537.32, 屋顶: 514.8 } },
  { code: '整改_SG320_外部风扇更换', unit: '台', prices: { 平地: 40.22, 水上: 60.33, 山地: 40.22, 高原: 48.26, 屋顶: 40.22, 海上: 104.57 } },
  { code: '维护_交流充电桩四级故障恢复', unit: '项', prices: { 平地: 160.88, 水上: 160.88, 山地: 160.88, 高原: 160.88, 屋顶: 160.88 } },
];

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text ?? '').trim();
    if ('richText' in value)
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
  }
  return String(value).trim();
}

function numberValue(value: ExcelJS.CellValue): number | null {
  const raw = cellText(value).replace(/,/g, '');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: ExcelJS.CellValue): Date | null {
  if (value instanceof Date) return value;
  const text = cellText(value);
  if (!text) return null;
  const parsed = new Date(
    text.replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(text) ? '' : '+08:00'),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnly(value: ExcelJS.CellValue): string | null {
  const text = cellText(value);
  if (!text) return null;
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = dateValue(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function normalizeRegion(province: string | null): {
  region: 'south_china' | 'yunnan';
  warning?: string;
} {
  const value = province || '';
  if (value.includes('云南')) return { region: 'yunnan' };
  if (['广东', '广西', '福建', '海南'].some((name) => value.includes(name))) {
    return { region: 'south_china' };
  }
  return { region: 'south_china', warning: `省份“${value || '空'}”未配置区域，已按华南处理` };
}

@Injectable()
export class ExcelParserService {
  async parsePo(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 中没有工作表');

    const header1 = Array.from({ length: 30 }, (_, index) =>
      cellText(sheet.getCell(1, index + 1).value),
    );
    const header2 = Array.from({ length: 30 }, (_, index) =>
      cellText(sheet.getCell(2, index + 1).value),
    );
    if (header1[0] !== 'PO单号' || header1[1] !== 'GSP案例号' || header2[19] !== '服务条目') {
      throw new BadRequestException('PO 表头不符合要求，请使用钉钉导出的双表头模板');
    }

    const orders = new Map<string, ParsedPoOrder>();
    const failures: Array<{ row: number; reason: string }> = [];
    const forward: string[] = [];
    let sourceItemRows = 0;

    for (let rowNo = 3; rowNo <= sheet.rowCount; rowNo += 1) {
      try {
        const row = sheet.getRow(rowNo);
        for (let col = 1; col <= 30; col += 1) {
          const current = cellText(row.getCell(col).value);
          if (current) forward[col] = current;
        }
        const value = (col: number) => cellText(row.getCell(col).value) || forward[col] || '';
        const poNo = value(1);
        const gspCaseNo = value(2);
        if (!poNo && !gspCaseNo) continue;
        if (!poNo || !gspCaseNo) throw new Error('PO单号或GSP案例号为空');

        let order = orders.get(poNo);
        if (!order) {
          order = {
            poNo,
            gspCaseNo,
            poTotalAmount: numberValue(row.getCell(3).value) ?? Number(forward[3] || 0),
            demandDate:
              dateOnly(row.getCell(4).value) ||
              dateOnly(forward[4] as unknown as ExcelJS.CellValue),
            demander: value(5) || null,
            demandType: value(6) || null,
            productLine: value(7) || null,
            productModel: value(8) || null,
            productQty:
              numberValue(row.getCell(9).value) ??
              numberValue(forward[9] as unknown as ExcelJS.CellValue),
            faultPhenomenon: value(10) || null,
            faultLevel: value(11) || null,
            durationReq: value(12) || null,
            demandDesc: value(13) || null,
            projectArea: value(14) || null,
            projectCountry: value(15) || null,
            projectRegion: value(16) || null,
            province: value(17) || null,
            projectName: value(18) || null,
            projectScene: value(19) || null,
            submitter: value(28) || null,
            dingtalkCreatedAt:
              dateValue(row.getCell(29).value) ||
              dateValue(forward[29] as unknown as ExcelJS.CellValue),
            dingtalkUpdatedAt:
              dateValue(row.getCell(30).value) ||
              dateValue(forward[30] as unknown as ExcelJS.CellValue),
            items: [],
          };
          orders.set(poNo, order);
        }

        const addItem = (category: 'special' | 'general', start: number) => {
          const itemName = cellText(row.getCell(start).value);
          if (!itemName) return false;
          const qty = numberValue(row.getCell(start + 3).value);
          if (qty === null)
            throw new Error(`${category === 'special' ? '专用' : '通用'}条目数量无效`);
          order!.items.push({
            sourceRow: rowNo,
            itemCategory: category,
            itemCode: itemName,
            itemName,
            itemDesc: cellText(row.getCell(start + 1).value) || null,
            unit: cellText(row.getCell(start + 2).value) || null,
            qty,
          });
          return true;
        };
        const hasSpecial = addItem('special', 20);
        const hasGeneral = addItem('general', 24);
        if (hasSpecial || hasGeneral) sourceItemRows += 1;
      } catch (error) {
        failures.push({
          row: rowNo,
          reason: error instanceof Error ? error.message : '单元格读取失败',
        });
      }
    }

    return {
      orders: [...orders.values()],
      failures,
      sourceItemRows,
      normalizedItemCount: [...orders.values()].reduce((sum, order) => sum + order.items.length, 0),
    };
  }

  async parseGspCases(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 中没有工作表');
    const aliases: Record<string, keyof ParsedGspCase> = {
      服务案例号: 'gspCaseNo',
      项目名称: 'projectName',
      服务类型: 'serviceType',
      创建人: 'creator',
      所属省份: 'province',
      省份: 'province',
      城市: 'city',
      现场描述: 'siteDesc',
      失效现场的具体描述: 'siteDesc',
    };
    let headerRow = 0;
    const columns = new Map<number, keyof ParsedGspCase>();
    for (let r = 1; r <= Math.min(sheet.rowCount, 10); r += 1) {
      sheet.getRow(r).eachCell((cell, col) => {
        const key = aliases[cellText(cell.value)];
        if (key) columns.set(col, key);
      });
      if (
        [...columns.values()].includes('gspCaseNo') &&
        [...columns.values()].includes('projectName')
      ) {
        headerRow = r;
        break;
      }
      columns.clear();
    }
    if (!headerRow) throw new BadRequestException('未找到GSP案例表头');

    const cases: ParsedGspCase[] = [];
    const failures: Array<{ row: number; reason: string }> = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
      const raw: Record<string, string> = {};
      for (const [col, key] of columns) raw[key] = cellText(sheet.getCell(r, col).value);
      if (!raw.gspCaseNo && !raw.projectName) continue;
      if (!raw.gspCaseNo || !raw.projectName) {
        failures.push({ row: r, reason: '服务案例号或项目名称为空' });
        continue;
      }
      const region = normalizeRegion(raw.province || null);
      cases.push({
        sourceRow: r,
        gspCaseNo: raw.gspCaseNo,
        projectName: raw.projectName,
        serviceType: raw.serviceType || null,
        creator: raw.creator || null,
        province: raw.province || null,
        city: raw.city || null,
        siteDesc: raw.siteDesc || null,
        ...region,
      });
    }
    return { cases, failures };
  }

  async parseSettlePrices(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet =
      workbook.worksheets.find((item) => item.name.includes('技术平台部')) ||
      workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('价格文件中没有工作表');
    const scenes = [
      { name: '平地', hours: 11 },
      { name: '水上', hours: 12 },
      { name: '山地', hours: 13 },
      { name: '高原', hours: 14 },
      { name: '屋顶', hours: 15 },
    ];
    const prices: ParsedSettlePrice[] = [];
    for (const quote of QUOTE_GENERAL_PRICES) {
      prices.push({
        sourceRow: 0,
        itemCode: quote.code,
        itemName: quote.name,
        itemDesc: '服务报价单“通用”部分最终应答单价',
        unit: quote.unit,
        productModel: null,
        scene: null,
        workHours: null,
        unitPrice: quote.unitPrice,
      });
    }
    for (const quote of QUOTE_SUPPLEMENT_PRICES) {
      for (const [scene, unitPrice] of Object.entries(quote.prices)) {
        prices.push({
          sourceRow: 0,
          itemCode: quote.code,
          itemName: quote.code,
          itemDesc: '正式服务报价单补充条目最终应答单价',
          unit: quote.unit,
          productModel: null,
          scene,
          workHours: null,
          unitPrice,
        });
      }
    }
    for (let r = 8; r <= sheet.rowCount; r += 1) {
      const productModelRaw = cellText(sheet.getCell(r, 6).value);
      const serviceProduct = cellText(sheet.getCell(r, 7).value);
      if (!serviceProduct) continue;
      const modelList = productModelRaw
        ? [
            ...new Set(
              productModelRaw
                .split(/[\/、,，]/)
                .map((value) => value.trim())
                .filter(Boolean),
            ),
          ]
        : [];
      const baseCodes = new Set<string>([
        serviceProduct,
        serviceProduct.startsWith('运维_')
          ? serviceProduct.replace(/^运维_/, '维护_')
          : serviceProduct,
      ]);
      // “在途”工时位于独立列，不属于平地/水上等现场场景。
      // 附件 1 的“其他_在途”需要生成一条通用价，否则 PO 中“在途1”永远无法定价。
      if (serviceProduct === '其他_在途') {
        const workHours = numberValue(sheet.getCell(r, 10).value);
        if (workHours !== null && workHours > 0) {
          prices.push({
            sourceRow: r,
            itemCode: serviceProduct,
            itemName: serviceProduct,
            itemDesc: cellText(sheet.getCell(r, 8).value) || null,
            unit: cellText(sheet.getCell(r, 9).value) || null,
            productModel: null,
            scene: null,
            workHours,
            unitPrice: Math.round(workHours * 81.25 * 0.99 * 100) / 100,
          });
        }
      }
      const pushScenePrices = (itemCode: string, productModel: string | null) => {
        for (const scene of scenes) {
          const workHours = numberValue(sheet.getCell(r, scene.hours).value);
          if (workHours === null || workHours <= 0) continue;
          const unitPrice = workHours * 81.25 * 0.99;
          prices.push({
            sourceRow: r,
            itemCode,
            itemName: itemCode,
            itemDesc: cellText(sheet.getCell(r, 8).value) || null,
            unit: cellText(sheet.getCell(r, 9).value) || null,
            // 附件1有产品型号则写入；为空则留 null，页面显示「通用」
            productModel,
            scene: scene.name,
            workHours,
            unitPrice: Math.round(unitPrice * 100) / 100,
          });
        }
      };
      const modelsOrGeneral = modelList.length ? modelList : [null];
      for (const itemCode of baseCodes) {
        for (const model of modelsOrGeneral) {
          pushScenePrices(itemCode, model);
        }
      }
      // 整机更换：按型号展开编码，型号字段与编码保持一致
      if (serviceProduct.startsWith('整机更换_') && modelList.length) {
        for (const model of modelList) {
          pushScenePrices(`整机更换_${model}_维修`, model);
          pushScenePrices(`整机更换_${model}_整改`, model);
        }
      }
    }

    // 第 3 个工作表给出了在途、入场、备机搬运、离场等综合工时。
    // 这些费用依赖“产品型号 + 服务动作”，因此编码中保留上下文，核算时再按 PO 匹配。
    const comprehensive = workbook.worksheets[2];
    if (comprehensive) {
      for (let r = 5; r <= comprehensive.rowCount; r += 1) {
        const model = cellText(comprehensive.getCell(r, 4).value);
        const serviceProject = cellText(comprehensive.getCell(r, 5).value);
        if (!model || !serviceProject) continue;
        const level1 = cellText(comprehensive.getCell(r, 6).value);
        const level2 = cellText(comprehensive.getCell(r, 7).value);
        const description = cellText(comprehensive.getCell(r, 8).value);
        const unit = cellText(comprehensive.getCell(r, 9).value) || '次';
        const context = [model, serviceProject, level1, level2, String(r)].join('::');
        const addGeneralPrice = (kind: string, hours: number | null) => {
          if (hours === null || hours <= 0) return;
          prices.push({
            sourceRow: r,
            itemCode: `通用_${kind}::${context}`,
            itemName: `${kind}（${model} / ${serviceProject}）`,
            itemDesc: description || null,
            unit,
            productModel: model.slice(0, 64),
            scene: null,
            workHours: hours,
            unitPrice: Math.round(hours * 81.25 * 0.99 * 100) / 100,
          });
        };
        addGeneralPrice('在途', numberValue(comprehensive.getCell(r, 11).value));
        const entry = numberValue(comprehensive.getCell(r, 12).value) || 0;
        const exit = numberValue(comprehensive.getCell(r, 19).value) || 0;
        addGeneralPrice('入离场', entry + exit || null);
        addGeneralPrice('搬运', numberValue(comprehensive.getCell(r, 18).value));
      }
    }
    return { prices, failures: [] as Array<{ row: number; reason: string }> };
  }

  /**
   * 内部绩效价清单（表头行）：
   * 条目编码 / 条目名称 / 产品型号 / 项目场景 / 区域 / 合作类型 / 单位 / 工时 / 单价 / 状态 / 生效日期 / 定价依据
   */
  async parsePerfPrices(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet =
      workbook.worksheets.find((item) => /绩效/.test(item.name)) || workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('绩效价文件中没有工作表');

    let headerRow = 1;
    const headerIndex = new Map<string, number>();
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r += 1) {
      const labels: string[] = [];
      for (let c = 1; c <= Math.min(20, sheet.columnCount || 20); c += 1) {
        const label = cellText(sheet.getCell(r, c).value);
        if (label) labels.push(label);
      }
      if (labels.some((label) => /条目编码|编码/.test(label))) {
        headerRow = r;
        for (let c = 1; c <= Math.min(20, sheet.columnCount || 20); c += 1) {
          const label = cellText(sheet.getCell(r, c).value);
          if (label) headerIndex.set(label, c);
        }
        break;
      }
    }
    const col = (...names: string[]) => {
      for (const name of names) {
        const hit = [...headerIndex.entries()].find(([label]) => label.includes(name));
        if (hit) return hit[1];
      }
      return 0;
    };
    const cCode = col('条目编码', '编码');
    const cName = col('条目名称', '名称');
    const cModel = col('产品型号', '型号');
    const cScene = col('项目场景', '场景');
    const cRegion = col('区域');
    const cCoop = col('合作');
    const cUnit = col('单位');
    const cHours = col('工时');
    const cPrice = col('单价');
    const cStatus = col('状态');
    const cDate = col('生效');
    const cDesc = col('定价依据', '说明', '描述');
    if (!cCode || !cPrice) {
      throw new BadRequestException('未识别到「条目编码」「单价」列，请使用绩效价导入清单模板');
    }

    const prices: ParsedPerfPrice[] = [];
    const failures: Array<{ row: number; reason: string }> = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
      const itemCode = cellText(sheet.getCell(r, cCode).value);
      if (!itemCode) continue;
      const unitPrice = numberValue(sheet.getCell(r, cPrice).value);
      if (unitPrice === null) {
        failures.push({ row: r, reason: '单价无效' });
        continue;
      }
      const statusText = cStatus ? cellText(sheet.getCell(r, cStatus).value) : '启用';
      const dateRaw = cDate ? sheet.getCell(r, cDate).value : null;
      let effectiveDate: string | null = null;
      if (dateRaw instanceof Date) {
        effectiveDate = dateRaw.toISOString().slice(0, 10);
      } else {
        const text = cellText(dateRaw);
        if (/^\d{4}-\d{2}-\d{2}/.test(text)) effectiveDate = text.slice(0, 10);
      }
      prices.push({
        sourceRow: r,
        itemCode,
        itemName: (cName ? cellText(sheet.getCell(r, cName).value) : '') || itemCode,
        itemDesc: cDesc ? cellText(sheet.getCell(r, cDesc).value) || null : null,
        unit: cUnit ? cellText(sheet.getCell(r, cUnit).value) || null : null,
        productModel: normalizeBlank(cModel ? cellText(sheet.getCell(r, cModel).value) : ''),
        scene: normalizeBlank(cScene ? cellText(sheet.getCell(r, cScene).value) : ''),
        region: normalizePerfRegion(cRegion ? cellText(sheet.getCell(r, cRegion).value) : ''),
        coopType: normalizePerfCoop(cCoop ? cellText(sheet.getCell(r, cCoop).value) : ''),
        workHours: cHours ? numberValue(sheet.getCell(r, cHours).value) : null,
        unitPrice,
        effectiveDate,
        status: /停用|inactive|disabled/i.test(statusText) ? 'inactive' : 'active',
      });
    }
    return { prices, failures };
  }
}

function normalizeBlank(value: string): string | null {
  const text = String(value || '').trim();
  if (!text || text === '通用' || text === '-' || text === '/') return null;
  return text;
}

function normalizePerfRegion(value: string): string | null {
  const text = String(value || '').trim();
  if (!text || text === '通用') return null;
  if (/云南|yunnan/i.test(text)) return 'yunnan';
  if (/华南|south/i.test(text)) return 'south_china';
  return text.slice(0, 16);
}

function normalizePerfCoop(value: string): string | null {
  const text = String(value || '').trim();
  if (!text || text === '通用') return null;
  if (/自做|self/i.test(text)) return 'self';
  if (/外包|外协|out/i.test(text)) return 'outsource';
  return text.slice(0, 16);
}
