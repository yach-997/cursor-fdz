import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CasePerformance, InspectionTemplate, PoItem, PoOrder, ServiceCase } from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import { ChangeLogService } from './change-log.service';
import { FinanceScopeService } from './finance-scope.service';
import { DashboardQueryDto, FinanceCaseQueryDto, PoOrderQueryDto } from '../dto/finance.dto';
import { UserRole } from '../../../common/enums';
import { assertFinanceClearAllowed } from '../../../common/utils/finance-clear-guard';
import { applyDemandTypeForCases } from './demand-type-match';

@Injectable()
export class FinanceQueryService {
  constructor(
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(PoOrder) private readonly orders: Repository<PoOrder>,
    @InjectRepository(PoItem) private readonly items: Repository<PoItem>,
    @InjectRepository(CasePerformance) private readonly performance: Repository<CasePerformance>,
    @InjectRepository(InspectionTemplate)
    private readonly templates: Repository<InspectionTemplate>,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
  ) {}

  async clearCases(user: CurrentUserContext, confirm?: string) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可清空案例');
    }
    assertFinanceClearAllowed(confirm);
    const total = await this.cases.count();
    await this.cases.manager.transaction(async (em) => {
      // 案例派单会建巡检任务/报告/占位设备；只删案例会导致 H5「本月统计」残留
      await em.query(`
        DELETE FROM inspection_records
        WHERE task_id IN (
          SELECT id FROM inspection_tasks WHERE service_case_id IS NOT NULL
        )
      `);
      await em.query(`DELETE FROM inspection_tasks WHERE service_case_id IS NOT NULL`);
      await em.query(`DELETE FROM devices WHERE serial_number LIKE 'CASE-%'`);
      await em.query('DELETE FROM case_work_record');
      await em.query('DELETE FROM case_performance');
      await em.query('DELETE FROM service_case');
    });
    await this.logs.write(
      'service_case',
      'all',
      'case_clear',
      { total },
      { deleted: total },
      user.id,
      `清空全部费用案例及关联巡检，共 ${total} 条`,
    );
    return { deleted: total };
  }

  /**
   * 从零复测：仅清空业务过程数据，保留账号、网格、设备、模板、标准图和价格配置。
   * 仅 Preview/测试环境的超级管理员可执行，并复用危险操作确认保护。
   */
  async clearTestData(user: CurrentUserContext, confirm?: string) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可重置测试数据');
    }
    assertFinanceClearAllowed(confirm);

    const counts = await this.cases.manager.transaction(async (em) => {
      const tables = [
        'inspection_records',
        'inspection_tasks',
        'case_work_record',
        'case_performance',
        'po_item',
        'po_order',
        'service_case',
        'assessment_event',
        'monthly_settlement',
        'assessment',
        'import_batch',
      ] as const;
      const before: Record<string, number> = {};
      for (const table of tables) {
        const rows = (await em.query(`SELECT COUNT(*)::int AS count FROM ${table}`)) as Array<{
          count: number;
        }>;
        before[table] = Number(rows[0]?.count || 0);
      }

      await em.query('DELETE FROM inspection_records');
      await em.query('DELETE FROM inspection_tasks');
      await em.query(`DELETE FROM devices WHERE serial_number LIKE 'CASE-%'`);
      await em.query('DELETE FROM case_work_record');
      await em.query('DELETE FROM case_performance');
      await em.query('DELETE FROM po_item');
      await em.query('DELETE FROM po_order');
      await em.query('DELETE FROM service_case');
      await em.query('DELETE FROM assessment_event');
      await em.query('DELETE FROM monthly_settlement');
      await em.query('DELETE FROM assessment');
      await em.query('DELETE FROM import_batch');

      return before;
    });

    await this.logs.write(
      'system_test_data',
      'all',
      'test_data_clear',
      counts,
      { preserved: ['users', 'sites', 'devices', 'inspection_templates', 'price_library'] },
      user.id,
      '清空测试业务数据，保留账号、网格、设备、模板、标准图和价格配置',
    );
    return { cleared: counts };
  }

  async clearPoOrders(user: CurrentUserContext, confirm?: string) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可清空 PO');
    }
    assertFinanceClearAllowed(confirm);
    const total = await this.orders.count();
    await this.orders.manager.transaction(async (em) => {
      await em.query('DELETE FROM po_item');
      await em.query('DELETE FROM po_order');
    });
    await this.logs.write(
      'po_order',
      'all',
      'po_clear',
      { total },
      { deleted: total },
      user.id,
      `清空全部 PO 订单，共 ${total} 条`,
    );
    return { deleted: total };
  }

  async listCases(query: FinanceCaseQueryDto, user: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const qb = this.cases
      .createQueryBuilder('c')
      .leftJoin(CasePerformance, 'p', 'p.service_case_id = c.id')
      .leftJoin('sites', 's', 's.id = c.site_id')
      .leftJoin('users', 'mgr', 'mgr.id = s.manager_id')
      .leftJoin('users', 'ins', 'ins.id = c.inspector_id')
      .leftJoin('inspection_templates', 'tpl', 'tpl.id = c.task_template_id')
      .select([
        'c.id AS id',
        'c.gsp_case_no AS "gspCaseNo"',
        'c.project_name AS "projectName"',
        'c.service_type AS "serviceType"',
        'c.product_line AS "productLine"',
        'c.creator AS creator',
        'c.province AS province',
        'c.city AS city',
        'c.site_desc AS "siteDesc"',
        'c.region AS region',
        'c.status AS status',
        'c.site_id AS "siteId"',
        's.name AS "siteName"',
        'mgr.real_name AS "siteManagerName"',
        'c.task_type AS "taskType"',
        'c.task_template_id AS "taskTemplateId"',
        'tpl.name AS "taskTypeName"',
        // 派单模式以案例自身为准（派单时用户选择），不跟服务类型模板默认走
        `COALESCE(c.assign_mode, 'single') AS "assignMode"`,
        'c.planned_units AS "plannedUnits"',
        'c.completed_units AS "completedUnits"',
        'c.expense_enabled AS "expenseEnabled"',
        'COALESCE(c.unit_label, tpl.unit_label, \'台\') AS "unitLabel"',
        'c.inspector_id AS "inspectorId"',
        `COALESCE(
          (
            SELECT string_agg(u.real_name, '、' ORDER BY ca.assign_time NULLS LAST, ca.id)
            FROM case_assignment ca
            INNER JOIN users u ON u.id = ca.inspector_id
            WHERE ca.service_case_id = c.id AND ca.status <> 'withdrawn'
          ),
          ins.real_name
        ) AS "inspectorName"`,
        'c.finish_time AS "finishTime"',
        'c.updated_at AS "updatedAt"',
        'COALESCE(p.case_revenue,0) AS "caseRevenue"',
      ]);
    // 网格长：仅看已挂到自己管辖网格的案例（未分配只给管理员）
    if (user.role === UserRole.SITE_MANAGER) {
      if (!user.managedSiteIds?.length) {
        return { list: [], total: 0, page, limit };
      }
      if (query.siteBind === 'unassigned') {
        return { list: [], total: 0, page, limit };
      }
      if (query.siteId) {
        if (!user.managedSiteIds.includes(query.siteId)) {
          throw new ForbiddenException('无权查看该网格案例');
        }
        qb.andWhere('c.site_id = :siteId', { siteId: query.siteId });
      } else {
        qb.andWhere('c.site_id IN (:...siteIds)', { siteIds: user.managedSiteIds });
      }
    } else {
      if (query.siteId) qb.andWhere('c.site_id = :siteId', { siteId: query.siteId });
      if (query.siteBind === 'unassigned') qb.andWhere('c.site_id IS NULL');
      if (query.siteBind === 'assigned_site') qb.andWhere('c.site_id IS NOT NULL');
    }
    if (query.region) qb.andWhere('c.region = :filterRegion', { filterRegion: query.region });
    if (query.province?.trim()) {
      qb.andWhere('c.province = :province', { province: query.province.trim() });
    }
    if (query.city?.trim()) {
      qb.andWhere('c.city = :city', { city: query.city.trim() });
    }
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.taskType) {
      const uuidLike =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          query.taskType,
        );
      if (uuidLike) {
        qb.andWhere('c.task_template_id = :taskTemplateId', { taskTemplateId: query.taskType });
      } else {
        qb.andWhere('(c.task_type = :taskType OR tpl.name = :taskType)', {
          taskType: query.taskType,
        });
      }
    }
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

  /** 案例列表筛选用：已有省份/城市去重选项 */
  async caseLocationOptions(user: CurrentUserContext) {
    const qb = this.cases
      .createQueryBuilder('c')
      .select('c.province', 'province')
      .addSelect('c.city', 'city')
      .where("COALESCE(TRIM(c.province), '') <> ''");
    if (user.role === UserRole.SITE_MANAGER) {
      if (!user.managedSiteIds?.length) {
        return { provinces: [] as string[], citiesByProvince: {} as Record<string, string[]> };
      }
      qb.andWhere('c.site_id IN (:...siteIds)', { siteIds: user.managedSiteIds });
    }
    const rows = await qb
      .distinct(true)
      .orderBy('c.province', 'ASC')
      .addOrderBy('c.city', 'ASC')
      .getRawMany<{
        province: string;
        city: string | null;
      }>();
    const provinces = [
      ...new Set(rows.map((row) => String(row.province || '').trim()).filter(Boolean)),
    ];
    const citiesByProvince: Record<string, string[]> = {};
    for (const row of rows) {
      const province = String(row.province || '').trim();
      const city = String(row.city || '').trim();
      if (!province || !city) continue;
      const list = citiesByProvince[province] || (citiesByProvince[province] = []);
      if (!list.includes(city)) list.push(city);
    }
    return { provinces, citiesByProvince };
  }

  async caseDetail(id: string, user: CurrentUserContext) {
    const item = await this.cases.findOne({ where: { id } });
    if (!item) throw new NotFoundException('案例不存在');
    this.scope.assertCaseAccess(user, item);
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
    const siteRow = item.siteId
      ? (
          await this.cases.manager.query(
            `SELECT s.name, u.real_name AS "managerName"
             FROM sites s
             LEFT JOIN users u ON u.id = s.manager_id
             WHERE s.id = $1 LIMIT 1`,
            [item.siteId],
          )
        )[0]
      : null;
    const inspectorName = item.inspectorId
      ? (
          await this.cases.manager.query(
            `SELECT real_name AS "realName" FROM users WHERE id = $1 LIMIT 1`,
            [item.inspectorId],
          )
        )[0]?.realName
      : null;
    const taskTypeName = item.taskTemplateId
      ? (
          await this.cases.manager.query(
            `SELECT name FROM inspection_templates WHERE id = $1 LIMIT 1`,
            [item.taskTemplateId],
          )
        )[0]?.name
      : null;
    const assignments = await this.cases.manager.query(
      `SELECT a.inspector_id AS "inspectorId",
              a.status AS status,
              u.real_name AS "inspectorName",
              u.username AS username,
              u.phone AS phone
       FROM case_assignment a
       LEFT JOIN users u ON u.id = a.inspector_id
       WHERE a.service_case_id = $1
         AND a.status IN ('assigned', 'working', 'done')
       ORDER BY a.assign_time ASC NULLS LAST`,
      [id],
    );
    return {
      ...item,
      siteName: siteRow?.name || null,
      siteManagerName: siteRow?.managerName || null,
      inspectorName: inspectorName || null,
      taskTypeName: taskTypeName || item.taskType || null,
      assignments: assignments || [],
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
    const qb = this.orders
      .createQueryBuilder('po')
      .leftJoin(ServiceCase, 'c', 'c.id = po.service_case_id')
      .select(['po', 'c.region AS "caseRegion"']);
    // 网格长：只看已挂到本网格案例的 PO（未匹配/未挂网格 PO 仅管理员可见）
    if (user.role === UserRole.SITE_MANAGER) {
      if (!user.managedSiteIds?.length) {
        return { list: [], total: 0, page, limit };
      }
      qb.andWhere('c.site_id IN (:...siteIds)', { siteIds: user.managedSiteIds });
    }
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
    const orderIds = raw.entities.map((entity) => entity.id);
    const items = orderIds.length
      ? await this.items.find({
          where: { poId: In(orderIds) },
          order: { sourceRow: 'ASC', id: 'ASC' },
        })
      : [];
    const itemsByPo = new Map<string, PoItem[]>();
    for (const item of items) {
      const list = itemsByPo.get(item.poId) || [];
      list.push(item);
      itemsByPo.set(item.poId, list);
    }
    return {
      list: raw.entities.map((entity, index) => {
        const poItems = itemsByPo.get(entity.id) || [];
        return {
          ...entity,
          caseRegion: raw.raw[index]?.caseRegion,
          items: poItems,
          specialItemCount: poItems.filter((x) => x.itemCategory === 'special').length,
          generalItemCount: poItems.filter((x) => x.itemCategory === 'general').length,
        };
      }),
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
    this.scope.assertCaseAccess(user, serviceCase);
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
    const failures: Array<{ poNo: string; reason: string }> = [];
    const eligible = pendingOrders;
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
    const toSync: ServiceCase[] = [];
    for (const order of eligible) {
      const sc = caseMap.get(order.gspCaseNo);
      if (!sc) continue;
      if (!sc.serviceType && order.demandType) {
        sc.serviceType = order.demandType;
        toSync.push(sc);
      }
    }
    if (toSync.length) await this.cases.save(toSync, { chunk: 100 });
    await applyDemandTypeForCases(this.cases, this.templates, [...caseMap.values()]);
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
    this.scope.assertCaseAccess(user, serviceCase);
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
      .addSelect(
        "COALESCE(SUM(CASE WHEN item.item_category='general' THEN item.item_revenue ELSE 0 END),0)",
        'otherCost',
      )
      .addSelect('COALESCE(p.perf_final,0)', 'perfFinal')
      .groupBy('po.id')
      .addGroupBy('c.id')
      .addGroupBy('p.case_revenue')
      .addGroupBy('p.perf_final');
    if (user.role === UserRole.SITE_MANAGER) {
      if (!user.managedSiteIds?.length) {
        return {
          summary: {
            income: 0,
            poTotalAmount: 0,
            varianceAmount: 0,
            varianceRate: 0,
            poCount: 0,
            caseCount: 0,
            pendingMatch: 0,
            pendingPrice: 0,
            ignoredCount: 0,
            okCount: 0,
          },
          ignoredItems: [],
          monthlyIncome: [],
        };
      }
      qb.andWhere('c.site_id IN (:...siteIds)', { siteIds: user.managedSiteIds });
    }
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
      monthlyIncome.set(month, (monthlyIncome.get(month) || 0) + Number(row.pricedRevenue || 0));
    }
    const income = [...cases.values()].reduce((sum, value) => sum + value, 0);
    const poTotalAmount = rows.reduce((sum, row) => sum + Number(row.poTotalAmount || 0), 0);
    const performanceByCase = new Map<string, number>();
    rows.forEach(
      (row) => row.caseId && performanceByCase.set(row.caseId, Number(row.perfFinal || 0)),
    );
    const performanceExpense = [...performanceByCase.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
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
    if (user.role === UserRole.SITE_MANAGER) {
      ignoredQb.andWhere('c.site_id IN (:...siteIds)', { siteIds: user.managedSiteIds });
    }
    if (query.from) ignoredQb.andWhere('po.demand_date>=:from', { from: query.from });
    if (query.to) ignoredQb.andWhere('po.demand_date<=:to', { to: query.to });
    if (query.project) ignoredQb.andWhere('po.project_name=:project', { project: query.project });
    if (query.province) ignoredQb.andWhere('po.province=:province', { province: query.province });
    if (query.demandType)
      ignoredQb.andWhere('po.demand_type=:demandType', { demandType: query.demandType });
    const ignoredRows = await ignoredQb.getRawMany<{
      itemCode: string;
      count: string;
      qty: string;
    }>();

    const adminOnly =
      user.role === UserRole.SUPER_ADMIN
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

  /** 收入与 PO 偏差明细：拆分原因 + 案例/未匹配 PO 清单 */
  async dashboardVariance(query: DashboardQueryDto, user: CurrentUserContext) {
    const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const applyPoScope = <T extends { andWhere: (...args: unknown[]) => T }>(qb: T) => {
      if (user.role === UserRole.SITE_MANAGER) {
        if (!user.managedSiteIds?.length) return null;
        qb.andWhere('c.site_id IN (:...siteIds)', { siteIds: user.managedSiteIds });
      }
      if (query.from) qb.andWhere('po.demand_date>=:from', { from: query.from });
      if (query.to) qb.andWhere('po.demand_date<=:to', { to: query.to });
      if (query.project) qb.andWhere('po.project_name=:project', { project: query.project });
      if (query.province) qb.andWhere('po.province=:province', { province: query.province });
      if (query.demandType)
        qb.andWhere('po.demand_type=:demandType', { demandType: query.demandType });
      return qb;
    };

    if (user.role === UserRole.SITE_MANAGER && !user.managedSiteIds?.length) {
      return {
        summary: {
          income: 0,
          poTotalAmount: 0,
          varianceAmount: 0,
          varianceRate: 0,
          pendingPrice: 0,
          ignoredCount: 0,
          okCount: 0,
          unmatchedPoCount: 0,
          unmatchedPoAmount: 0,
          caseGapCount: 0,
          caseGapAmount: 0,
        },
        buckets: [],
        cases: [],
        unmatchedPos: [],
        ignoredItems: [],
      };
    }

    const dash = await this.dashboard(query, user);
    const income = Number(dash.summary.income || 0);
    const poTotalAmount = Number(dash.summary.poTotalAmount || 0);
    const varianceAmount = Number(dash.summary.varianceAmount || 0);
    const varianceRate = Number(dash.summary.varianceRate || 0);

    const unmatchedQb = this.orders
      .createQueryBuilder('po')
      .leftJoin(ServiceCase, 'c', 'c.id = po.service_case_id')
      .select('po.id', 'id')
      .addSelect('po.po_no', 'poNo')
      .addSelect('po.gsp_case_no', 'gspCaseNo')
      .addSelect('po.project_name', 'projectName')
      .addSelect('po.po_total_amount', 'poTotalAmount')
      .addSelect('po.match_status', 'matchStatus')
      .where('(po.service_case_id IS NULL OR po.match_status = :pending)', { pending: 'pending' })
      .orderBy('po.po_total_amount', 'DESC')
      .limit(100);
    if (!applyPoScope(unmatchedQb)) {
      /* scoped empty already handled */
    }
    const unmatchedRows = await unmatchedQb.getRawMany<{
      id: string;
      poNo: string;
      gspCaseNo: string;
      projectName: string;
      poTotalAmount: string;
      matchStatus: string;
    }>();
    const unmatchedPos = unmatchedRows.map((row) => ({
      id: row.id,
      poNo: row.poNo,
      gspCaseNo: row.gspCaseNo,
      projectName: row.projectName || '-',
      poTotalAmount: Number(row.poTotalAmount || 0),
      matchStatus: row.matchStatus,
    }));
    const unmatchedPoAmount = money(
      unmatchedPos.reduce((sum, row) => sum + row.poTotalAmount, 0),
    );

    const caseQb = this.orders
      .createQueryBuilder('po')
      .innerJoin(ServiceCase, 'c', 'c.id = po.service_case_id')
      .leftJoin(CasePerformance, 'p', 'p.service_case_id = c.id')
      .leftJoin(PoItem, 'item', 'item.po_id = po.id')
      .select('c.id', 'caseId')
      .addSelect('c.gsp_case_no', 'gspCaseNo')
      .addSelect('c.project_name', 'projectName')
      .addSelect('COALESCE(SUM(DISTINCT po.po_total_amount), 0)', 'poTotalAmount')
      .addSelect('COALESCE(MAX(p.case_revenue), 0)', 'caseRevenue')
      .addSelect("COUNT(item.id) FILTER (WHERE item.price_status = 'pending_price')", 'pendingPrice')
      .addSelect("COUNT(item.id) FILTER (WHERE item.price_status = 'ignored')", 'ignoredCount')
      .addSelect("COUNT(item.id) FILTER (WHERE item.price_status = 'ok')", 'okCount')
      .where('po.service_case_id IS NOT NULL')
      .andWhere("po.match_status <> 'pending'")
      .groupBy('c.id')
      .addGroupBy('c.gsp_case_no')
      .addGroupBy('c.project_name');
    applyPoScope(caseQb);
    const caseRows = await caseQb.getRawMany<{
      caseId: string;
      gspCaseNo: string;
      projectName: string;
      poTotalAmount: string;
      caseRevenue: string;
      pendingPrice: string;
      ignoredCount: string;
      okCount: string;
    }>();

    // SUM(DISTINCT po.po_total_amount) can be wrong if amounts collide; recompute per case safely
    const casePoTotals = new Map<string, number>();
    const poCaseQb = this.orders
      .createQueryBuilder('po')
      .innerJoin(ServiceCase, 'c', 'c.id = po.service_case_id')
      .select('c.id', 'caseId')
      .addSelect('po.id', 'poId')
      .addSelect('po.po_total_amount', 'poTotalAmount')
      .where('po.service_case_id IS NOT NULL')
      .andWhere("po.match_status <> 'pending'");
    applyPoScope(poCaseQb);
    const poCaseRows = await poCaseQb.getRawMany<{
      caseId: string;
      poId: string;
      poTotalAmount: string;
    }>();
    const seenPo = new Set<string>();
    for (const row of poCaseRows) {
      if (seenPo.has(row.poId)) continue;
      seenPo.add(row.poId);
      casePoTotals.set(
        row.caseId,
        money((casePoTotals.get(row.caseId) || 0) + Number(row.poTotalAmount || 0)),
      );
    }

    const cases = caseRows
      .map((row) => {
        const poAmt = casePoTotals.get(row.caseId) ?? Number(row.poTotalAmount || 0);
        const revenue = Number(row.caseRevenue || 0);
        const gap = money(poAmt - revenue);
        return {
          caseId: row.caseId,
          gspCaseNo: row.gspCaseNo,
          projectName: row.projectName || '-',
          poTotalAmount: poAmt,
          caseRevenue: revenue,
          gap,
          pendingPrice: Number(row.pendingPrice || 0),
          ignoredCount: Number(row.ignoredCount || 0),
          okCount: Number(row.okCount || 0),
          reason:
            Number(row.pendingPrice || 0) > 0
              ? '存在待定价条目'
              : Number(row.ignoredCount || 0) > 0 && Math.abs(gap) > 0.009
                ? '含忽略条目或定价未覆盖 PO 总额'
                : Math.abs(gap) > 0.009
                  ? '核算收入与 PO 总额不一致'
                  : '无显著偏差',
        };
      })
      .filter((row) => Math.abs(row.gap) > 0.009 || row.pendingPrice > 0 || row.ignoredCount > 0)
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 100);

    const caseGapAmount = money(
      cases.reduce((sum, row) => sum + Math.max(0, row.gap), 0),
    );

    const buckets = [
      {
        key: 'unmatched',
        label: '未匹配案例的 PO',
        amount: unmatchedPoAmount,
        count: unmatchedPos.length,
        tip: 'PO 已计入总额，但尚未挂到案例，核算收入为 0',
      },
      {
        key: 'case_gap',
        label: '已匹配案例核算缺口',
        amount: caseGapAmount,
        count: cases.filter((row) => row.gap > 0.009).length,
        tip: '多为待定价、忽略条目，或条目收入合计对不上 PO 头金额',
      },
      {
        key: 'pending_price',
        label: '待定价条目（条数）',
        amount: 0,
        count: Number(dash.summary.pendingPrice || 0),
        tip: '待定价不会进入核算收入，请到价格库批量映射',
      },
      {
        key: 'ignored',
        label: '忽略条目（条数）',
        amount: 0,
        count: Number(dash.summary.ignoredCount || 0),
        tip: '名称如「无」「自定义」等不计入核算',
      },
    ];

    return {
      summary: {
        income,
        poTotalAmount,
        varianceAmount,
        varianceRate,
        pendingPrice: Number(dash.summary.pendingPrice || 0),
        ignoredCount: Number(dash.summary.ignoredCount || 0),
        okCount: Number(dash.summary.okCount || 0),
        unmatchedPoCount: unmatchedPos.length,
        unmatchedPoAmount,
        caseGapCount: cases.filter((row) => row.gap > 0.009).length,
        caseGapAmount,
      },
      buckets,
      cases,
      unmatchedPos,
      ignoredItems: dash.ignoredItems || [],
    };
  }
}
