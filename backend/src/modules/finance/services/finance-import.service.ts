import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  CasePerformance,
  ChangeLog,
  ImportBatch,
  PoItem,
  PoOrder,
  PriceLibrary,
  ServiceCase,
  ItemPriceMapping,
} from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import { ExcelParserService, ParsedPoOrder } from './excel-parser.service';
import { FinanceScopeService } from './finance-scope.service';
import { isIgnoredItem, pickMappedPrice } from './item-matcher';

const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

@Injectable()
export class FinanceImportService {
  constructor(
    private readonly parser: ExcelParserService,
    private readonly dataSource: DataSource,
    private readonly scope: FinanceScopeService,
    @InjectRepository(ImportBatch) private readonly batches: Repository<ImportBatch>,
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(PoOrder) private readonly orders: Repository<PoOrder>,
    @InjectRepository(PoItem) private readonly items: Repository<PoItem>,
    @InjectRepository(PriceLibrary) private readonly prices: Repository<PriceLibrary>,
    @InjectRepository(CasePerformance) private readonly performance: Repository<CasePerformance>,
    @InjectRepository(ItemPriceMapping) private readonly mappings: Repository<ItemPriceMapping>,
  ) {}

  async importGsp(file: Express.Multer.File, user: CurrentUserContext, preview = false) {
    this.assertExcel(file);
    const parsed = await this.parser.parseGspCases(file.buffer);
    if (preview)
      return {
        preview: parsed.cases.slice(0, 20),
        totalRows: parsed.cases.length,
        failures: parsed.failures,
      };
    const scopedRegion = await this.scope.region(user);
    const batch = await this.createBatch(
      'gsp_case',
      file.originalname,
      parsed.cases.length + parsed.failures.length,
      user.id,
    );
    let success = 0;
    const failures = [...parsed.failures];
    for (const item of parsed.cases) {
      try {
        if (scopedRegion && item.region !== scopedRegion) throw new Error('站长只能导入本区域案例');
        const old = await this.cases.findOne({ where: { gspCaseNo: item.gspCaseNo } });
        const entity =
          old ||
          this.cases.create({ gspCaseNo: item.gspCaseNo, status: 'pending_assign', version: 0 });
        Object.assign(entity, item, { importBatchId: batch.id, version: (old?.version || 0) + 1 });
        await this.cases.save(entity);
        success += 1;
      } catch (error) {
        failures.push({
          row: item.sourceRow,
          reason: error instanceof Error ? error.message : '导入失败',
        });
      }
    }
    await this.finishBatch(batch, success, failures);
    return {
      batchId: batch.id,
      totalRows: batch.totalRows,
      successRows: success,
      failRows: failures.length,
      warnings: parsed.cases
        .filter((x) => x.warning)
        .map((x) => ({ row: x.sourceRow, warning: x.warning })),
    };
  }

  async importPo(file: Express.Multer.File, user: CurrentUserContext, preview = false) {
    this.assertExcel(file);
    const parsed = await this.parser.parsePo(file.buffer);
    if (preview)
      return {
        preview: parsed.orders.slice(0, 20),
        totalOrders: parsed.orders.length,
        sourceItemRows: parsed.sourceItemRows,
        normalizedItemCount: parsed.normalizedItemCount,
        failures: parsed.failures,
      };
    const scopedRegion = await this.scope.region(user);
    const batch = await this.createBatch(
      'po_order',
      file.originalname,
      parsed.orders.length,
      user.id,
    );
    const activePrices = await this.prices.find({
      where: { status: 'active' },
      order: { effectiveDate: 'DESC' },
    });
    const activeMappings = await this.mappings.find({ where: { status: 'active' } });
    let success = 0;
    let generatedCases = 0;
    const failures = [...parsed.failures];
    for (const parsedOrder of parsed.orders) {
      try {
        const region = parsedOrder.province?.includes('云南') ? 'yunnan' : 'south_china';
        if (scopedRegion && region !== scopedRegion) throw new Error('站长只能导入本区域PO');
        const result = await this.savePo(
          parsedOrder,
          batch.id,
          user.id,
          activePrices,
          activeMappings,
        );
        if (result.generatedCase) generatedCases += 1;
        success += 1;
      } catch (error) {
        failures.push({
          row: parsedOrder.items[0]?.sourceRow || 0,
          reason: `${parsedOrder.poNo}: ${error instanceof Error ? error.message : '导入失败'}`,
        });
      }
    }
    await this.finishBatch(batch, success, failures);
    return {
      batchId: batch.id,
      totalOrders: parsed.orders.length,
      sourceItemRows: parsed.sourceItemRows,
      normalizedItemCount: parsed.normalizedItemCount,
      successRows: success,
      failRows: failures.length,
      generatedCases,
      matchedOrders: success,
    };
  }

  async importSettlePrices(file: Express.Multer.File, user: CurrentUserContext, preview = false) {
    this.assertExcel(file);
    const parsed = await this.parser.parseSettlePrices(file.buffer);
    if (preview)
      return {
        preview: parsed.prices.slice(0, 20),
        totalRows: parsed.prices.length,
        failures: parsed.failures,
      };
    const batch = await this.createBatch(
      'settle_price',
      file.originalname,
      parsed.prices.length,
      user.id,
    );
    let success = 0;
    const failures = [...parsed.failures];
    for (const price of parsed.prices) {
      try {
        const effectiveDate = new Date().toISOString().slice(0, 10);
        let entity = await this.prices.findOne({
          where: {
            priceType: 'settle',
            itemCode: price.itemCode,
            productModel: price.productModel || IsNull(),
            scene: price.scene || IsNull(),
            effectiveDate,
          },
        });
        entity ||= this.prices.create({
          priceType: 'settle',
          region: null,
          coopType: null,
          status: 'active',
          effectiveDate,
        });
        Object.assign(entity, price, {
          unitPrice: money(price.unitPrice),
          workHours: price.workHours === null ? null : money(price.workHours),
          createdBy: user.id,
          changeRemark: `由${file.originalname}初始化，已应用0.990应答系数`,
        });
        await this.prices.save(entity);
        success += 1;
      } catch (error) {
        failures.push({
          row: price.sourceRow,
          reason: error instanceof Error ? error.message : '价格导入失败',
        });
      }
    }
    await this.finishBatch(batch, success, failures);
    return {
      batchId: batch.id,
      totalRows: parsed.prices.length,
      successRows: success,
      failRows: failures.length,
    };
  }

  async listBatches(type?: string) {
    return this.batches.find({
      where: type ? { importType: type as any } : {},
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
  async failures(id: string) {
    const batch = await this.batches.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('导入批次不存在');
    return batch.failDetail;
  }

  private async savePo(
    parsed: ParsedPoOrder,
    batchId: string,
    operatorId: string,
    prices: PriceLibrary[],
    mappings: ItemPriceMapping[],
  ) {
    return this.dataSource.transaction(async (manager) => {
      const caseRepo = manager.getRepository(ServiceCase);
      const orderRepo = manager.getRepository(PoOrder);
      const itemRepo = manager.getRepository(PoItem);
      const logRepo = manager.getRepository(ChangeLog);
      const performanceRepo = manager.getRepository(CasePerformance);
      let serviceCase = await caseRepo.findOne({ where: { gspCaseNo: parsed.gspCaseNo } });
      let generatedCase = false;
      if (!serviceCase) {
        const region = parsed.province?.includes('云南') ? 'yunnan' : 'south_china';
        serviceCase = await caseRepo.save(
          caseRepo.create({
            gspCaseNo: parsed.gspCaseNo,
            projectName: parsed.projectName || parsed.poNo,
            serviceType: parsed.demandType,
            creator: parsed.submitter,
            province: parsed.province,
            city: parsed.projectRegion,
            siteDesc: parsed.demandDesc || parsed.projectArea,
            region,
            status: 'settle_review',
            finishTime:
              parsed.dingtalkUpdatedAt ||
              (parsed.demandDate ? new Date(`${parsed.demandDate}T12:00:00+08:00`) : new Date()),
            importBatchId: batchId,
            version: 1,
          }),
        );
        generatedCase = true;
      }
      let order = await orderRepo.findOne({ where: { poNo: parsed.poNo } });
      if (order) {
        await logRepo.save(
          logRepo.create({
            entityType: 'po_order',
            entityId: order.id,
            field: 'import_overwrite',
            oldValue: JSON.stringify(order),
            newValue: JSON.stringify({ poNo: parsed.poNo, itemCount: parsed.items.length }),
            operatorId,
            reason: '同一PO重复导入覆盖',
          }),
        );
        await itemRepo.delete({ poId: order.id });
      } else order = orderRepo.create();
      Object.assign(order, parsed, {
        poTotalAmount: money(parsed.poTotalAmount),
        productQty: parsed.productQty === null ? null : money(parsed.productQty),
        items: undefined,
        serviceCaseId: serviceCase?.id || null,
        matchStatus: serviceCase ? 'matched' : 'pending',
        importBatchId: batchId,
      });
      order = await orderRepo.save(order);
      const contextItemNames = parsed.items
        .filter((entry) => entry.itemCategory === 'special' && !isIgnoredItem(entry.itemCode))
        .map((entry) => entry.itemCode);
      const entities = parsed.items.map((item) => {
        const ignored = isIgnoredItem(item.itemCode);
        const settleMatch = pickMappedPrice(
          prices,
          item.itemCode,
          parsed.projectScene,
          parsed.productModel,
          mappings,
          contextItemNames,
          parsed.demandType,
        );
        const settle = settleMatch?.price;
        const perf = this.pickPrice(
          prices,
          'perf',
          item.itemCode,
          null,
          parsed.productModel,
          serviceCase?.region || (parsed.province?.includes('云南') ? 'yunnan' : 'south_china'),
          'self',
        );
        return itemRepo.create({
          ...item,
          poId: order.id,
          qty: money(item.qty),
          settlePrice: settle?.unitPrice || null,
          perfPrice: perf?.unitPrice || null,
          itemRevenue: money(item.qty * Number(settle?.unitPrice || 0)),
          itemPerf: money(item.qty * Number(perf?.unitPrice || 0)),
          priceStatus: ignored ? 'ignored' : settle ? 'ok' : 'pending_price',
        });
      });
      await itemRepo.save(entities);
      if (serviceCase) {
        // 巡检先完工、PO 后到达是正常业务顺序；PO 一旦匹配即进入结算审核。
        if (serviceCase.status === 'finished') {
          serviceCase.status = 'settle_review';
          await caseRepo.save(serviceCase);
        }
        const totals = await itemRepo
          .createQueryBuilder('item')
          .innerJoin(PoOrder, 'po', 'po.id = item.po_id')
          .select('COALESCE(SUM(item.item_revenue),0)', 'revenue')
          .addSelect('COALESCE(SUM(item.item_perf),0)', 'perf')
          .where('po.service_case_id = :id', { id: serviceCase.id })
          .getRawOne();
        let ledger = await performanceRepo.findOne({ where: { serviceCaseId: serviceCase.id } });
        ledger ||= performanceRepo.create({
          serviceCaseId: serviceCase.id,
          gspCaseNo: serviceCase.gspCaseNo,
          inspectorId: serviceCase.inspectorId,
          deduction: '0.00',
          reviewStatus: 'pending',
        });
        ledger.caseRevenue = money(Number(totals.revenue));
        ledger.perfBase = money(Number(totals.perf));
        ledger.perfFinal = money(Number(totals.perf) - Number(ledger.deduction || 0));
        await performanceRepo.save(ledger);
      }
      return { generatedCase, serviceCaseId: serviceCase.id };
    });
  }

  private pickPrice(
    prices: PriceLibrary[],
    type: 'settle' | 'perf',
    code: string,
    scene: string | null,
    model: string | null,
    region: string | null,
    coop: string | null,
  ) {
    return prices
      .filter(
        (p) =>
          p.priceType === type &&
          p.itemCode === code &&
          (!p.productModel || p.productModel === model) &&
          (!p.scene || p.scene === scene) &&
          (!p.region || p.region === region) &&
          (!p.coopType || p.coopType === coop),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.scene)) - Number(Boolean(a.scene)) ||
          Number(Boolean(b.productModel)) - Number(Boolean(a.productModel)) ||
          Number(Boolean(b.region)) - Number(Boolean(a.region)) ||
          b.effectiveDate.localeCompare(a.effectiveDate),
      )[0];
  }
  private assertExcel(file?: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('请选择Excel文件');
    if (!file.originalname.toLowerCase().endsWith('.xlsx'))
      throw new BadRequestException('仅支持.xlsx文件');
  }
  private async createBatch(type: any, fileName: string, totalRows: number, operatorId: string) {
    return this.batches.save(
      this.batches.create({
        importType: type,
        fileName,
        totalRows,
        successRows: 0,
        failRows: 0,
        failDetail: [],
        operatorId,
      }),
    );
  }
  private async finishBatch(
    batch: ImportBatch,
    success: number,
    failures: Array<{ row: number; reason: string }>,
  ) {
    batch.successRows = success;
    batch.failRows = failures.length;
    batch.failDetail = failures;
    await this.batches.save(batch);
  }
}
