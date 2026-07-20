import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CasePerformance, PoItem, PoOrder, ServiceCase } from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import { ChangeLogService } from './change-log.service';
import { FinanceScopeService } from './finance-scope.service';
import { DashboardQueryDto, FinanceCaseQueryDto, PoOrderQueryDto } from '../dto/finance.dto';
import { UserRole } from '../../../common/enums';

@Injectable()
export class FinanceQueryService {
  constructor(
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(PoOrder) private readonly orders: Repository<PoOrder>,
    @InjectRepository(PoItem) private readonly items: Repository<PoItem>,
    @InjectRepository(CasePerformance) private readonly performance: Repository<CasePerformance>,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
  ) {}

  async listCases(query: FinanceCaseQueryDto, user: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const region = await this.scope.region(user);
    const qb = this.cases
      .createQueryBuilder('c')
      .leftJoin(CasePerformance, 'p', 'p.service_case_id = c.id')
      .select([
        'c.id AS id',
        'c.gsp_case_no AS "gspCaseNo"',
        'c.project_name AS "projectName"',
        'c.service_type AS "serviceType"',
        'c.province AS province',
        'c.city AS city',
        'c.region AS region',
        'c.status AS status',
        'c.inspector_id AS "inspectorId"',
        'c.finish_time AS "finishTime"',
        'c.updated_at AS "updatedAt"',
        'COALESCE(p.case_revenue,0) AS "caseRevenue"',
      ]);
    if (region) qb.andWhere('c.region = :region', { region });
    if (query.region) qb.andWhere('c.region = :filterRegion', { filterRegion: query.region });
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.month)
      qb.andWhere("to_char(COALESCE(c.finish_time,c.created_at),'YYYY-MM') = :month", {
        month: query.month,
      });
    if (query.keyword)
      qb.andWhere('(c.gsp_case_no ILIKE :kw OR c.project_name ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    const total = await qb.clone().getCount();
    const list = await qb
      .orderBy('c.updated_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();
    return { list, total, page, limit };
  }

  async caseDetail(id: string, user: CurrentUserContext) {
    const item = await this.cases.findOne({ where: { id } });
    if (!item) throw new NotFoundException('案例不存在');
    await this.scope.assertRegion(user, item.region);
    const orders = await this.orders.find({
      where: { serviceCaseId: id },
      order: { demandDate: 'DESC' },
    });
    const poItems = orders.length
      ? await this.items.find({
          where: orders.map((po) => ({ poId: po.id })),
          order: { sourceRow: 'ASC' },
        })
      : [];
    const ledger = await this.performance.findOne({ where: { serviceCaseId: id } });
    const poTotal = orders.reduce((sum, order) => sum + Number(order.poTotalAmount), 0);
    const revenue = Number(ledger?.caseRevenue || 0);
    const varianceRate = poTotal ? Math.abs(revenue - poTotal) / poTotal : 0;
    const visibleItems = poItems.map((entry) => {
      if (user.role === UserRole.SUPER_ADMIN) return entry;
      const safe: Partial<PoItem> = { ...entry };
      delete safe.perfPrice;
      return safe;
    });
    return {
      ...item,
      orders: orders.map((order) => ({
        ...order,
        items: visibleItems.filter((entry) => entry.poId === order.id),
      })),
      ledger,
      reconciliation: {
        poTotal: poTotal.toFixed(2),
        caseRevenue: revenue.toFixed(2),
        varianceRate,
        warning: varianceRate > 0.01 ? '收入与PO总金额存在偏差，请核对条目' : null,
      },
      changes: await this.logs.list('service_case', id),
    };
  }

  async listPo(query: PoOrderQueryDto, user: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const region = await this.scope.region(user);
    const qb = this.orders
      .createQueryBuilder('po')
      .leftJoin(ServiceCase, 'c', 'c.id = po.service_case_id')
      .select(['po', 'c.region AS "caseRegion"']);
    if (region)
      qb.andWhere(
        "COALESCE(c.region, CASE WHEN po.province LIKE '%云南%' THEN 'yunnan' ELSE 'south_china' END) = :region",
        { region },
      );
    if (query.matchStatus)
      qb.andWhere('po.match_status = :matchStatus', { matchStatus: query.matchStatus });
    if (query.keyword)
      qb.andWhere('(po.po_no ILIKE :kw OR po.gsp_case_no ILIKE :kw OR po.project_name ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    const total = await qb.clone().getCount();
    const raw = await qb
      .orderBy('po.updated_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawAndEntities();
    return {
      list: raw.entities.map((entity, index) => ({
        ...entity,
        caseRegion: raw.raw[index]?.caseRegion,
      })),
      total,
      page,
      limit,
    };
  }

  async matchPo(id: string, gspCaseNo: string, user: CurrentUserContext) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('PO不存在');
    const serviceCase = await this.cases.findOne({ where: { gspCaseNo } });
    if (!serviceCase) throw new NotFoundException('目标案例不存在');
    await this.scope.assertRegion(user, serviceCase.region);
    const old = { gspCaseNo: order.gspCaseNo, serviceCaseId: order.serviceCaseId };
    order.gspCaseNo = gspCaseNo;
    order.serviceCaseId = serviceCase.id;
    order.matchStatus = 'matched';
    await this.orders.save(order);
    await this.recalculateCase(serviceCase.id);
    await this.logs.write(
      'po_order',
      order.id,
      'case_match',
      old,
      { gspCaseNo, serviceCaseId: serviceCase.id },
      user.id,
      '人工挂接案例',
    );
    return order;
  }

  async generateCasesFromPo(user: CurrentUserContext) {
    const pendingOrders = await this.orders.find({
      where: { matchStatus: 'pending' },
      order: { demandDate: 'ASC' },
    });
    const scopedRegion = await this.scope.region(user);
    const failures: Array<{ poNo: string; reason: string }> = [];
    const eligible = pendingOrders.filter((order) => {
      const region = order.province?.includes('云南') ? 'yunnan' : 'south_china';
      if (!scopedRegion || scopedRegion === region) return true;
      failures.push({ poNo: order.poNo, reason: '无权处理其他区域的费用数据' });
      return false;
    });
    if (!eligible.length) {
      return {
        pendingOrders: pendingOrders.length,
        generatedCases: 0,
        matchedOrders: 0,
        failRows: failures.length,
        failures,
      };
    }
    const existing = await this.cases.find({
      where: { gspCaseNo: In(eligible.map((order) => order.gspCaseNo)) },
    });
    const caseMap = new Map(existing.map((item) => [item.gspCaseNo, item]));
    const created = await this.cases.save(
      eligible
        .filter((order) => !caseMap.has(order.gspCaseNo))
        .map((order) =>
          this.cases.create({
            gspCaseNo: order.gspCaseNo,
            projectName: order.projectName || order.poNo,
            serviceType: order.demandType,
            creator: order.submitter,
            province: order.province,
            city: order.projectRegion,
            siteDesc: order.demandDesc || order.projectArea,
            region: order.province?.includes('云南') ? 'yunnan' : 'south_china',
            status: 'settle_review',
            finishTime:
              order.dingtalkUpdatedAt ||
              (order.demandDate ? new Date(`${order.demandDate}T12:00:00+08:00`) : order.updatedAt),
            importBatchId: order.importBatchId,
            version: 1,
          }),
        ),
      { chunk: 100 },
    );
    for (const item of created) caseMap.set(item.gspCaseNo, item);
    for (const order of eligible) {
      order.serviceCaseId = caseMap.get(order.gspCaseNo)!.id;
      order.matchStatus = 'matched';
    }
    await this.orders.save(eligible, { chunk: 100 });
    await this.recalculateCases(eligible.map((order) => order.serviceCaseId!));
    return {
      pendingOrders: pendingOrders.length,
      generatedCases: created.length,
      matchedOrders: eligible.length,
      failRows: failures.length,
      failures,
    };
  }

  private async recalculateCases(caseIds: string[]) {
    const uniqueIds = [...new Set(caseIds)];
    if (!uniqueIds.length) return;
    const [cases, existing, totals] = await Promise.all([
      this.cases.find({ where: { id: In(uniqueIds) } }),
      this.performance.find({ where: { serviceCaseId: In(uniqueIds) } }),
      this.items
        .createQueryBuilder('item')
        .innerJoin(PoOrder, 'po', 'po.id=item.po_id')
        .select('po.service_case_id', 'caseId')
        .addSelect('COALESCE(SUM(item.item_revenue),0)', 'revenue')
        .addSelect('COALESCE(SUM(item.item_perf),0)', 'perf')
        .where('po.service_case_id IN (:...caseIds)', { caseIds: uniqueIds })
        .groupBy('po.service_case_id')
        .getRawMany(),
    ]);
    const caseMap = new Map(cases.map((item) => [item.id, item]));
    const ledgerMap = new Map(existing.map((item) => [item.serviceCaseId, item]));
    const ledgers = totals.map((total) => {
      const serviceCase = caseMap.get(total.caseId)!;
      let ledger = ledgerMap.get(total.caseId);
      ledger ||= this.performance.create({
        serviceCaseId: total.caseId,
        gspCaseNo: serviceCase.gspCaseNo,
        inspectorId: serviceCase.inspectorId,
        deduction: '0.00',
        reviewStatus: 'pending',
      });
      ledger.caseRevenue = Number(total.revenue || 0).toFixed(2);
      ledger.perfBase = Number(total.perf || 0).toFixed(2);
      ledger.perfFinal = (Number(total.perf || 0) - Number(ledger.deduction || 0)).toFixed(2);
      return ledger;
    });
    await this.performance.save(ledgers, { chunk: 100 });
    const finished = cases.filter((item) => item.status === 'finished');
    if (finished.length) {
      finished.forEach((item) => (item.status = 'settle_review'));
      await this.cases.save(finished, { chunk: 100 });
    }
  }

  async recalculatePo(id: string, user: CurrentUserContext) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('PO不存在');
    if (!order.serviceCaseId) throw new NotFoundException('PO尚未匹配案例');
    const serviceCase = await this.cases.findOne({ where: { id: order.serviceCaseId } });
    if (!serviceCase) throw new NotFoundException('关联案例不存在');
    await this.scope.assertRegion(user, serviceCase.region);
    return this.recalculateCase(serviceCase.id);
  }

  private async recalculateCase(serviceCaseId: string) {
    const serviceCase = await this.cases.findOne({ where: { id: serviceCaseId } });
    if (!serviceCase) throw new NotFoundException('案例不存在');
    const totals = await this.items
      .createQueryBuilder('item')
      .innerJoin(PoOrder, 'po', 'po.id=item.po_id')
      .select('COALESCE(SUM(item.item_revenue),0)', 'revenue')
      .addSelect('COALESCE(SUM(item.item_perf),0)', 'perf')
      .where('po.service_case_id=:id', { id: serviceCaseId })
      .getRawOne();
    let ledger = await this.performance.findOne({ where: { serviceCaseId } });
    ledger ||= this.performance.create({
      serviceCaseId,
      gspCaseNo: serviceCase.gspCaseNo,
      inspectorId: serviceCase.inspectorId,
      deduction: '0.00',
      reviewStatus: 'pending',
    });
    ledger.caseRevenue = Number(totals.revenue || 0).toFixed(2);
    ledger.perfBase = Number(totals.perf || 0).toFixed(2);
    ledger.perfFinal = (Number(totals.perf || 0) - Number(ledger.deduction || 0)).toFixed(2);
    const saved = await this.performance.save(ledger);
    if (serviceCase.status === 'finished') {
      serviceCase.status = 'settle_review';
      await this.cases.save(serviceCase);
    }
    return saved;
  }

  async dashboard(query: DashboardQueryDto, user: CurrentUserContext) {
    const region = await this.scope.region(user);
    const qb = this.orders
      .createQueryBuilder('po')
      .leftJoin(ServiceCase, 'c', 'c.id=po.service_case_id')
      .leftJoin(CasePerformance, 'p', 'p.service_case_id=c.id')
      .leftJoin(PoItem, 'item', 'item.po_id=po.id')
      .select('po.id', 'poId')
      .addSelect('po.po_total_amount', 'poTotalAmount')
      .addSelect('po.demand_date', 'demandDate')
      .addSelect("to_char(po.demand_date, 'YYYY-MM')", 'month')
      .addSelect('po.match_status', 'matchStatus')
      .addSelect('c.id', 'caseId')
      .addSelect('COALESCE(p.case_revenue,0)', 'caseRevenue')
      .addSelect('COALESCE(SUM(item.item_revenue),0)', 'pricedRevenue')
      .addSelect("COUNT(item.id) FILTER (WHERE item.price_status='pending_price')", 'pendingPrice')
      .addSelect("COUNT(item.id) FILTER (WHERE item.price_status='ignored')", 'ignoredCount')
      .addSelect("COUNT(item.id) FILTER (WHERE item.price_status='ok')", 'okCount')
      .addSelect("COALESCE(SUM(CASE WHEN item.item_category='general' THEN item.item_revenue ELSE 0 END),0)", 'otherCost')
      .addSelect('COALESCE(p.perf_final,0)', 'perfFinal')
      .groupBy('po.id')
      .addGroupBy('c.id')
      .addGroupBy('p.case_revenue')
      .addGroupBy('p.perf_final');
    if (region)
      qb.andWhere(
        "COALESCE(c.region, CASE WHEN po.province LIKE '%云南%' THEN 'yunnan' ELSE 'south_china' END)=:region",
        { region },
      );
    if (query.from) qb.andWhere('po.demand_date>=:from', { from: query.from });
    if (query.to) qb.andWhere('po.demand_date<=:to', { to: query.to });
    if (query.project) qb.andWhere('po.project_name=:project', { project: query.project });
    if (query.province) qb.andWhere('po.province=:province', { province: query.province });
    if (query.demandType)
      qb.andWhere('po.demand_type=:demandType', { demandType: query.demandType });
    const rows = await qb.getRawMany();
    const cases = new Map<string, number>();
    const monthlyIncome = new Map<string, number>();
    for (const row of rows) {
      if (!row.caseId) continue;
      cases.set(row.caseId, Number(row.caseRevenue || 0));
      const month = row.month || '未知月份';
      monthlyIncome.set(
        month,
        (monthlyIncome.get(month) || 0) + Number(row.pricedRevenue || 0),
      );
    }
    const income = [...cases.values()].reduce((sum, value) => sum + value, 0);
    const poTotalAmount = rows.reduce((sum, row) => sum + Number(row.poTotalAmount || 0), 0);
    const performanceByCase = new Map<string, number>();
    rows.forEach((row) => row.caseId && performanceByCase.set(row.caseId, Number(row.perfFinal || 0)));
    const performanceExpense = [...performanceByCase.values()].reduce((sum, value) => sum + value, 0);
    const otherCost = rows.reduce((sum, row) => sum + Number(row.otherCost || 0), 0);
    const ignoredCount = rows.reduce((sum, row) => sum + Number(row.ignoredCount || 0), 0);
    const okCount = rows.reduce((sum, row) => sum + Number(row.okCount || 0), 0);
    const pendingPrice = rows.reduce((sum, row) => sum + Number(row.pendingPrice || 0), 0);
    const varianceAmount = Math.round((poTotalAmount - income) * 100) / 100;

    const ignoredQb = this.items
      .createQueryBuilder('item')
      .innerJoin(PoOrder, 'po', 'po.id = item.po_id')
      .leftJoin(ServiceCase, 'c', 'c.id = po.service_case_id')
      .select('item.item_code', 'itemCode')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(item.qty::numeric),0)', 'qty')
      .where("item.price_status = 'ignored'")
      .groupBy('item.item_code')
      .orderBy('COUNT(*)', 'DESC')
      .limit(50);
    if (region)
      ignoredQb.andWhere(
        "COALESCE(c.region, CASE WHEN po.province LIKE '%云南%' THEN 'yunnan' ELSE 'south_china' END)=:region",
        { region },
      );
    if (query.from) ignoredQb.andWhere('po.demand_date>=:from', { from: query.from });
    if (query.to) ignoredQb.andWhere('po.demand_date<=:to', { to: query.to });
    if (query.project) ignoredQb.andWhere('po.project_name=:project', { project: query.project });
    if (query.province) ignoredQb.andWhere('po.province=:province', { province: query.province });
    if (query.demandType)
      ignoredQb.andWhere('po.demand_type=:demandType', { demandType: query.demandType });
    const ignoredRows = await ignoredQb.getRawMany<{ itemCode: string; count: string; qty: string }>();

    const adminOnly = user.role === UserRole.SUPER_ADMIN
      ? { performanceExpense, otherCost, grossProfit: income - performanceExpense - otherCost }
      : {};
    return {
      summary: {
        income,
        poTotalAmount,
        varianceAmount,
        varianceRate: poTotalAmount ? Math.abs(income - poTotalAmount) / poTotalAmount : 0,
        poCount: rows.length,
        caseCount: cases.size,
        pendingMatch: rows.filter((row) => row.matchStatus === 'pending').length,
        pendingPrice,
        ignoredCount,
        okCount,
        ...adminOnly,
      },
      ignoredItems: ignoredRows.map((row) => ({
        itemCode: row.itemCode,
        count: Number(row.count || 0),
        qty: Number(row.qty || 0),
      })),
      trend: [...monthlyIncome.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, value]) => ({
          month,
          income: value.toFixed(2),
        })),
    };
  }
}
