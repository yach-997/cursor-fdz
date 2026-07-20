import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  CasePerformance,
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
const PO_CHUNK = 40;
const PRICE_CHUNK = 200;

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
    const gspNos = [...new Set(parsed.cases.map((x) => x.gspCaseNo))];
    const existing = gspNos.length
      ? await this.cases.find({ where: { gspCaseNo: In(gspNos) } })
      : [];
    const caseMap = new Map(existing.map((row) => [row.gspCaseNo, row]));
    const toSave: ServiceCase[] = [];
    for (const item of parsed.cases) {
      try {
        if (scopedRegion && item.region !== scopedRegion) throw new Error('站长只能导入本区域案例');
        const old = caseMap.get(item.gspCaseNo);
        const entity =
          old ||
          this.cases.create({ gspCaseNo: item.gspCaseNo, status: 'pending_assign', version: 0 });
        Object.assign(entity, item, { importBatchId: batch.id, version: (old?.version || 0) + 1 });
        toSave.push(entity);
        caseMap.set(item.gspCaseNo, entity);
        success += 1;
      } catch (error) {
        failures.push({
          row: item.sourceRow,
          reason: error instanceof Error ? error.message : '导入失败',
        });
      }
    }
    for (let i = 0; i < toSave.length; i += PRICE_CHUNK) {
      await this.cases.save(toSave.slice(i, i + PRICE_CHUNK));
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

  async importPo(
    file: Express.Multer.File,
    user: CurrentUserContext,
    preview = false,
    options: { offset?: number; limit?: number; batchId?: string } = {},
  ) {
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

    const totalOrders = parsed.orders.length;
    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit ?? totalOrders;
    const slice = parsed.orders.slice(offset, offset + limit);
    const nextOffset = Math.min(totalOrders, offset + slice.length);
    const done = nextOffset >= totalOrders;

    const scopedRegion = await this.scope.region(user);
    const batch = await this.resolveBatch(
      options.batchId,
      'po_order',
      file.originalname,
      totalOrders,
      user.id,
    );
    const activePrices = await this.prices.find({
      where: { status: 'active' },
      order: { effectiveDate: 'DESC' },
    });
    const activeMappings = await this.mappings.find({ where: { status: 'active' } });
    let success = 0;
    let generatedCases = 0;
    const failures: Array<{ row: number; reason: string }> =
      offset === 0 ? [...parsed.failures] : [];

    for (let i = 0; i < slice.length; i += PO_CHUNK) {
      const chunk = slice.slice(i, i + PO_CHUNK);
      try {
        const result = await this.savePoChunk(
          chunk,
          batch.id,
          activePrices,
          activeMappings,
          scopedRegion,
        );
        success += result.success;
        generatedCases += result.generatedCases;
        failures.push(...result.failures);
      } catch (error) {
        for (const parsedOrder of chunk) {
          failures.push({
            row: parsedOrder.items[0]?.sourceRow || 0,
            reason: `${parsedOrder.poNo}: ${error instanceof Error ? error.message : '导入失败'}`,
          });
        }
      }
    }

    const mergedFailures = [
      ...((offset === 0 ? [] : batch.failDetail) || []),
      ...failures,
    ];
    const totalSuccess = Number(batch.successRows || 0) + success;
    await this.finishBatch(batch, totalSuccess, mergedFailures);
    return {
      batchId: batch.id,
      totalOrders,
      sourceItemRows: parsed.sourceItemRows,
      normalizedItemCount: parsed.normalizedItemCount,
      successRows: totalSuccess,
      failRows: mergedFailures.length,
      generatedCases,
      matchedOrders: totalSuccess,
      offset,
      nextOffset,
      done,
      chunkSuccess: success,
    };
  }

  async importSettlePrices(
    file: Express.Multer.File,
    user: CurrentUserContext,
    preview = false,
    options: { offset?: number; limit?: number; batchId?: string } = {},
  ) {
    this.assertExcel(file);
    const parsed = await this.parser.parseSettlePrices(file.buffer);
    if (preview)
      return {
        preview: parsed.prices.slice(0, 20),
        totalRows: parsed.prices.length,
        failures: parsed.failures,
      };

    const totalRows = parsed.prices.length;
    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit ?? totalRows;
    const slice = parsed.prices.slice(offset, offset + limit);
    const nextOffset = Math.min(totalRows, offset + slice.length);
    const done = nextOffset >= totalRows;

    const batch = await this.resolveBatch(
      options.batchId,
      'settle_price',
      file.originalname,
      totalRows,
      user.id,
    );
    const effectiveDate = new Date().toISOString().slice(0, 10);
    const existing = await this.prices.find({
      where: { priceType: 'settle', effectiveDate },
    });
    const priceKey = (itemCode: string, productModel: string | null, scene: string | null) =>
      `${itemCode}|${productModel || ''}|${scene || ''}`;
    const priceMap = new Map(
      existing.map((row) => [priceKey(row.itemCode, row.productModel, row.scene), row]),
    );
    let success = 0;
    const failures: Array<{ row: number; reason: string }> =
      offset === 0 ? [...parsed.failures] : [];
    const toSave: PriceLibrary[] = [];
    for (const price of slice) {
      try {
        const key = priceKey(price.itemCode, price.productModel, price.scene);
        let entity = priceMap.get(key);
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
        toSave.push(entity);
        priceMap.set(key, entity);
        success += 1;
      } catch (error) {
        failures.push({
          row: price.sourceRow,
          reason: error instanceof Error ? error.message : '价格导入失败',
        });
      }
    }
    for (let i = 0; i < toSave.length; i += PRICE_CHUNK) {
      await this.prices.save(toSave.slice(i, i + PRICE_CHUNK));
    }
    const mergedFailures = [
      ...((offset === 0 ? [] : batch.failDetail) || []),
      ...failures,
    ];
    const totalSuccess = Number(batch.successRows || 0) + success;
    await this.finishBatch(batch, totalSuccess, mergedFailures);
    return {
      batchId: batch.id,
      totalRows,
      successRows: totalSuccess,
      failRows: mergedFailures.length,
      offset,
      nextOffset,
      done,
      chunkSuccess: success,
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

  private async savePoChunk(
    chunk: ParsedPoOrder[],
    batchId: string,
    prices: PriceLibrary[],
    mappings: ItemPriceMapping[],
    scopedRegion: string | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const caseRepo = manager.getRepository(ServiceCase);
      const orderRepo = manager.getRepository(PoOrder);
      const itemRepo = manager.getRepository(PoItem);
      const performanceRepo = manager.getRepository(CasePerformance);

      const gspNos = [...new Set(chunk.map((row) => row.gspCaseNo))];
      const poNos = chunk.map((row) => row.poNo);
      const existingCases = gspNos.length
        ? await caseRepo.find({ where: { gspCaseNo: In(gspNos) } })
        : [];
      const existingOrders = poNos.length ? await orderRepo.find({ where: { poNo: In(poNos) } }) : [];
      const caseMap = new Map(existingCases.map((row) => [row.gspCaseNo, row]));
      const orderMap = new Map(existingOrders.map((row) => [row.poNo, row]));

      let success = 0;
      let generatedCases = 0;
      const failures: Array<{ row: number; reason: string }> = [];
      const overwriteIds: string[] = [];
      const ordersToSave: PoOrder[] = [];
      const itemsByPoNo = new Map<string, ReturnType<typeof itemRepo.create>[]>();
      const touchedCaseIds = new Set<string>();

      const missingCaseInputs = new Map<string, ParsedPoOrder>();
      for (const parsed of chunk) {
        if (!caseMap.has(parsed.gspCaseNo) && !missingCaseInputs.has(parsed.gspCaseNo)) {
          missingCaseInputs.set(parsed.gspCaseNo, parsed);
        }
      }
      if (missingCaseInputs.size) {
        const created = await caseRepo.save(
          [...missingCaseInputs.values()].map((parsed) => {
            const region = parsed.province?.includes('云南') ? 'yunnan' : 'south_china';
            return caseRepo.create({
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
            });
          }),
        );
        for (const row of created) caseMap.set(row.gspCaseNo, row);
        generatedCases += created.length;
      }

      const finishedCases: ServiceCase[] = [];
      for (const parsed of chunk) {
        try {
          const region = parsed.province?.includes('云南') ? 'yunnan' : 'south_china';
          if (scopedRegion && region !== scopedRegion) throw new Error('站长只能导入本区域PO');

          const serviceCase = caseMap.get(parsed.gspCaseNo);
          if (!serviceCase) throw new Error('案例创建失败');
          if (serviceCase.status === 'finished') {
            serviceCase.status = 'settle_review';
            finishedCases.push(serviceCase);
          }

          let order = orderMap.get(parsed.poNo);
          if (order?.id) overwriteIds.push(order.id);
          else order = orderRepo.create();

          Object.assign(order, parsed, {
            poTotalAmount: money(parsed.poTotalAmount),
            productQty: parsed.productQty === null ? null : money(parsed.productQty),
            items: undefined,
            serviceCaseId: serviceCase.id,
            matchStatus: 'matched',
            importBatchId: batchId,
          });
          ordersToSave.push(order);
          orderMap.set(parsed.poNo, order);

          const contextItemNames = parsed.items
            .filter((entry) => entry.itemCategory === 'special' && !isIgnoredItem(entry.itemCode))
            .map((entry) => entry.itemCode);
          itemsByPoNo.set(
            parsed.poNo,
            parsed.items.map((item) => {
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
                serviceCase.region || region,
                'self',
              );
              return itemRepo.create({
                ...item,
                poId: '',
                qty: money(item.qty),
                settlePrice: settle?.unitPrice || null,
                perfPrice: perf?.unitPrice || null,
                itemRevenue: money(item.qty * Number(settle?.unitPrice || 0)),
                itemPerf: money(item.qty * Number(perf?.unitPrice || 0)),
                priceStatus: ignored ? 'ignored' : settle ? 'ok' : 'pending_price',
              });
            }),
          );
          touchedCaseIds.add(serviceCase.id);
          success += 1;
        } catch (error) {
          failures.push({
            row: parsed.items[0]?.sourceRow || 0,
            reason: `${parsed.poNo}: ${error instanceof Error ? error.message : '导入失败'}`,
          });
        }
      }
      if (finishedCases.length) await caseRepo.save(finishedCases);

      if (overwriteIds.length) {
        await itemRepo.delete({ poId: In(overwriteIds) });
      }
      if (ordersToSave.length) {
        await orderRepo.save(ordersToSave);
      }

      const allItems: PoItem[] = [];
      for (const order of ordersToSave) {
        const rows = itemsByPoNo.get(order.poNo) || [];
        for (const row of rows) {
          row.poId = order.id;
          allItems.push(row);
        }
      }
      for (let i = 0; i < allItems.length; i += PRICE_CHUNK) {
        await itemRepo.save(allItems.slice(i, i + PRICE_CHUNK));
      }

      if (touchedCaseIds.size) {
        const caseIds = [...touchedCaseIds];
        const totals = await itemRepo
          .createQueryBuilder('item')
          .innerJoin(PoOrder, 'po', 'po.id = item.po_id')
          .select('po.service_case_id', 'serviceCaseId')
          .addSelect('COALESCE(SUM(item.item_revenue),0)', 'revenue')
          .addSelect('COALESCE(SUM(item.item_perf),0)', 'perf')
          .where('po.service_case_id IN (:...ids)', { ids: caseIds })
          .groupBy('po.service_case_id')
          .getRawMany<{ serviceCaseId: string; revenue: string; perf: string }>();
        const totalMap = new Map(totals.map((row) => [row.serviceCaseId, row]));
        const ledgers = await performanceRepo.find({
          where: { serviceCaseId: In(caseIds) },
        });
        const ledgerMap = new Map(ledgers.map((row) => [row.serviceCaseId, row]));
        const ledgersToSave: CasePerformance[] = [];
        for (const caseId of caseIds) {
          const serviceCase = [...caseMap.values()].find((row) => row.id === caseId);
          if (!serviceCase) continue;
          const total = totalMap.get(caseId);
          let ledger = ledgerMap.get(caseId);
          ledger ||= performanceRepo.create({
            serviceCaseId: caseId,
            gspCaseNo: serviceCase.gspCaseNo,
            inspectorId: serviceCase.inspectorId,
            deduction: '0.00',
            reviewStatus: 'pending',
          });
          ledger.caseRevenue = money(Number(total?.revenue || 0));
          ledger.perfBase = money(Number(total?.perf || 0));
          ledger.perfFinal = money(Number(total?.perf || 0) - Number(ledger.deduction || 0));
          ledgersToSave.push(ledger);
        }
        if (ledgersToSave.length) await performanceRepo.save(ledgersToSave);
      }

      return { success, generatedCases, failures };
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
  private async resolveBatch(
    batchId: string | undefined,
    type: any,
    fileName: string,
    totalRows: number,
    operatorId: string,
  ) {
    if (batchId) {
      const existing = await this.batches.findOne({ where: { id: batchId } });
      if (!existing) throw new NotFoundException('导入批次不存在');
      return existing;
    }
    return this.createBatch(type, fileName, totalRows, operatorId);
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
