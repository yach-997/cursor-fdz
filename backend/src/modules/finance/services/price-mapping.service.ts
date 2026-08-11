import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CasePerformance,
  ItemPriceMapping,
  PoItem,
  PoOrder,
  PriceLibrary,
  ServiceCase,
} from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import { monthKeyShanghai } from '../../../common/utils/month-key';
import { ChangeLogService } from './change-log.service';
import {
  builtinTargetCode,
  isIgnoredItem,
  modelMatches,
  normalizeItemName,
  pickMappedPrice,
} from './item-matcher';

const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

@Injectable()
export class PriceMappingService {
  constructor(
    @InjectRepository(ItemPriceMapping) private readonly mappings: Repository<ItemPriceMapping>,
    @InjectRepository(PriceLibrary) private readonly prices: Repository<PriceLibrary>,
    @InjectRepository(PoItem) private readonly items: Repository<PoItem>,
    @InjectRepository(PoOrder) private readonly orders: Repository<PoOrder>,
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(CasePerformance) private readonly performance: Repository<CasePerformance>,
    private readonly logs: ChangeLogService,
  ) {}

  async list() {
    const rows: Array<{ sourceItemName: string; totalCount: string; pendingCount: string }> =
      await this.items
        .createQueryBuilder('item')
        .select('item.item_code', 'sourceItemName')
        .addSelect('COUNT(*)', 'totalCount')
        .addSelect("COUNT(*) FILTER (WHERE item.price_status='pending_price')", 'pendingCount')
        .where("item.price_status != 'ignored'")
        .groupBy('item.item_code')
        .orderBy("COUNT(*) FILTER (WHERE item.price_status='pending_price')", 'DESC')
        .addOrderBy('item.item_code', 'ASC')
        .getRawMany();
    const ignoredRows: Array<{ sourceItemName: string; totalCount: string; qty: string }> =
      await this.items
        .createQueryBuilder('item')
        .select('item.item_code', 'sourceItemName')
        .addSelect('COUNT(*)', 'totalCount')
        .addSelect('COALESCE(SUM(item.qty::numeric),0)', 'qty')
        .where("item.price_status = 'ignored'")
        .groupBy('item.item_code')
        .orderBy('COUNT(*)', 'DESC')
        .getRawMany();
    const mappings = await this.mappings.find({ where: { status: 'active' } });
    const targetCodes = [
      ...new Set(
        (
          await this.prices.find({
            where: { priceType: 'settle', status: 'active' },
            order: { itemCode: 'ASC' },
          })
        ).map((price) => price.itemCode),
      ),
    ];
    return {
      list: rows.map((row) => {
        const saved = mappings.find((mapping) => mapping.sourceItemName === row.sourceItemName);
        const suggestion = saved ? null : builtinTargetCode(row.sourceItemName, targetCodes);
        return {
          ...row,
          totalCount: Number(row.totalCount),
          pendingCount: Number(row.pendingCount),
          targetItemCode: saved?.targetItemCode || null,
          mappingType: saved?.mappingType || null,
          suggestedTargetCode: suggestion?.targetItemCode || null,
          confidence: saved ? Number(saved.confidence) : suggestion?.confidence || null,
        };
      }),
      ignoredList: ignoredRows.map((row) => ({
        sourceItemName: row.sourceItemName,
        totalCount: Number(row.totalCount),
        qty: Number(row.qty || 0),
      })),
      targetCodes,
    };
  }

  async save(sourceItemName: string, targetItemCode: string, user: CurrentUserContext) {
    const target = await this.prices.findOne({
      where: { priceType: 'settle', itemCode: targetItemCode, status: 'active' },
    });
    if (!target) throw new BadRequestException('目标价格条目不存在或未启用');
    let mapping = await this.mappings.findOne({ where: { sourceItemName } });
    const old = mapping ? { ...mapping } : null;
    mapping ||= this.mappings.create({ sourceItemName });
    Object.assign(mapping, {
      normalizedSource: normalizeItemName(sourceItemName),
      targetItemCode,
      mappingType: 'manual',
      confidence: '1.0000',
      status: 'active',
      createdBy: user.id,
    });
    mapping = await this.mappings.save(mapping);
    await this.logs.write(
      'item_price_mapping',
      mapping.id,
      'mapping_update',
      old,
      mapping,
      user.id,
      '人工维护 PO 条目与价格库编码映射',
    );
    return { mapping, ...(await this.recalculate(sourceItemName)) };
  }

  async recalculate(sourceItemName?: string) {
    return this.repriceItems({ sourceItemName });
  }

  /** 仅重算指定 PO 下条目（手工编辑 PO / 案例区域变更后） */
  async repriceByPoIds(poIds: string[]) {
    const ids = [...new Set(poIds.filter(Boolean))];
    if (!ids.length) {
      return { affectedItems: 0, pricedItems: 0, pendingPrice: 0, income: '0.00' };
    }
    return this.repriceItems({ poIds: ids });
  }

  private async repriceItems(filter: { sourceItemName?: string; poIds?: string[] }) {
    const [prices, mappings, orders, cases] = await Promise.all([
      this.prices.find({ where: { status: 'active' }, order: { effectiveDate: 'DESC' } }),
      this.mappings.find({ where: { status: 'active' } }),
      filter.poIds?.length
        ? this.orders.find({ where: { id: In(filter.poIds) } })
        : this.orders.find(),
      this.cases.find(),
    ]);
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const caseMap = new Map(cases.map((item) => [item.id, item]));
    const entries = await this.items.find({
      where: filter.poIds?.length
        ? { poId: In(filter.poIds) }
        : filter.sourceItemName
          ? { itemCode: filter.sourceItemName }
          : {},
    });
    const contextEntries =
      filter.sourceItemName && !filter.poIds?.length ? await this.items.find() : entries;
    const entriesByPo = new Map<string, PoItem[]>();
    for (const entry of contextEntries) {
      if (!entriesByPo.has(entry.poId)) entriesByPo.set(entry.poId, []);
      entriesByPo.get(entry.poId)!.push(entry);
    }
    const affectedCases = new Set<string>();
    let priced = 0;
    for (const entry of entries) {
      const order = orderMap.get(entry.poId);
      if (!order) continue;
      if (isIgnoredItem(entry.itemCode)) {
        entry.settlePrice = null;
        entry.itemRevenue = '0.00';
        entry.perfPrice = null;
        entry.itemPerf = '0.00';
        entry.priceStatus = 'ignored';
        if (order.serviceCaseId) affectedCases.add(order.serviceCaseId);
        continue;
      }
      const serviceCase = order.serviceCaseId ? caseMap.get(order.serviceCaseId) : null;
      const contextItemNames = (entriesByPo.get(entry.poId) || [])
        .filter((item) => item.itemCategory === 'special' && !isIgnoredItem(item.itemCode))
        .map((item) => item.itemCode);
      const matched = pickMappedPrice(
        prices,
        entry.itemCode,
        order.projectScene,
        order.productModel,
        mappings,
        contextItemNames,
        order.demandType,
      );
      entry.settlePrice = matched?.price.unitPrice || null;
      entry.itemRevenue = money(Number(entry.qty) * Number(matched?.price.unitPrice || 0));
      entry.priceStatus = matched ? 'ok' : 'pending_price';

      const perfCodes = [
        ...new Set([matched?.price.itemCode, matched?.targetItemCode, entry.itemCode].filter(Boolean)),
      ] as string[];
      const perf =
        perfCodes
          .map((code) =>
            this.pickPerfPrice(
              prices,
              code,
              order.projectScene,
              order.productModel,
              serviceCase?.region || null,
            ),
          )
          .find(Boolean) || null;
      entry.perfPrice = perf?.unitPrice || null;
      entry.itemPerf = money(Number(entry.qty) * Number(perf?.unitPrice || 0));

      if (matched) priced += 1;
      if (order.serviceCaseId) affectedCases.add(order.serviceCaseId);
    }
    await this.items.save(entries, { chunk: 100 });
    await this.recalculateLedgers([...affectedCases], caseMap);
    const totals = filter.poIds?.length
      ? await this.items
          .createQueryBuilder('item')
          .select("COUNT(*) FILTER (WHERE item.price_status='pending_price')", 'pendingPrice')
          .addSelect('COALESCE(SUM(item.item_revenue),0)', 'income')
          .where('item.po_id IN (:...poIds)', { poIds: filter.poIds })
          .getRawOne()
      : await this.items
          .createQueryBuilder('item')
          .select("COUNT(*) FILTER (WHERE item.price_status='pending_price')", 'pendingPrice')
          .addSelect('COALESCE(SUM(item.item_revenue),0)', 'income')
          .getRawOne();
    return {
      affectedItems: entries.length,
      pricedItems: priced,
      pendingPrice: Number(totals.pendingPrice || 0),
      income: money(Number(totals.income || 0)),
    };
  }

  private pickPerfPrice(
    prices: PriceLibrary[],
    code: string,
    scene: string | null,
    model: string | null,
    region: string | null,
  ) {
    return prices
      .filter(
        (p) =>
          p.priceType === 'perf' &&
          p.status === 'active' &&
          p.itemCode === code &&
          (!p.productModel || modelMatches(p.productModel, model)) &&
          (!p.scene || p.scene === scene) &&
          (!p.region || p.region === region) &&
          (!p.coopType || p.coopType === 'self'),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.scene)) - Number(Boolean(a.scene)) ||
          Number(Boolean(b.productModel)) - Number(Boolean(a.productModel)) ||
          Number(Boolean(b.region)) - Number(Boolean(a.region)) ||
          b.effectiveDate.localeCompare(a.effectiveDate),
      )[0];
  }

  private async recalculateLedgers(caseIds: string[], caseMap: Map<string, ServiceCase>) {
    if (!caseIds.length) return;
    const totals: Array<{ caseId: string; revenue: string; perf: string }> = await this.items
      .createQueryBuilder('item')
      .innerJoin(PoOrder, 'po', 'po.id=item.po_id')
      .select('po.service_case_id', 'caseId')
      .addSelect('COALESCE(SUM(item.item_revenue),0)', 'revenue')
      .addSelect('COALESCE(SUM(item.item_perf),0)', 'perf')
      .where('po.service_case_id IN (:...caseIds)', { caseIds })
      .groupBy('po.service_case_id')
      .getRawMany();
    const existing = await this.performance.find({
      where: { serviceCaseId: In(caseIds) },
    });
    const ledgerMap = new Map(existing.map((ledger) => [ledger.serviceCaseId, ledger]));
    const ledgers: CasePerformance[] = [];
    for (const total of totals) {
      const serviceCase = caseMap.get(total.caseId);
      if (!serviceCase) continue;
      let ledger = ledgerMap.get(total.caseId);
      ledger ||= this.performance.create({
        serviceCaseId: total.caseId,
        gspCaseNo: serviceCase.gspCaseNo,
        inspectorId: serviceCase.inspectorId,
        deduction: '0.00',
        reviewStatus: 'pending',
      });
      ledger.caseRevenue = money(Number(total.revenue || 0));
      ledger.perfBase = money(Number(total.perf || 0));
      ledger.perfFinal = money(Number(total.perf || 0) - Number(ledger.deduction || 0));
      if (serviceCase.finishTime || !ledger.month) {
        ledger.month = monthKeyShanghai(serviceCase.finishTime || new Date());
      }
      ledgers.push(ledger);
    }
    await this.performance.save(ledgers, { chunk: 100 });
  }
}
