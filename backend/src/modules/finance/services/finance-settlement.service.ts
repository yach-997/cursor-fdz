import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import ExcelJS from 'exceljs';
import {
  Assessment,
  AssessmentEvent,
  CaseAssignment,
  CasePerformance,
  MonthlySettlement,
  ServiceCase,
  User,
} from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import { UserRole } from '../../../common/enums';
import {
  CorrectMonthlyDto,
  CreateAssessmentEventDto,
  RankAssessmentDto,
  SaveAssessmentDto,
} from '../dto/finance.dto';
import { FinanceScopeService } from './finance-scope.service';
import { ChangeLogService } from './change-log.service';
import { ASSESSMENT_EVENT_CATALOG, rankRewardAmount } from './assessment-event.catalog';
import { assertFinanceClearAllowed } from '../../../common/utils/finance-clear-guard';

const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

function applyPoolRankLabels<T extends { totalScore: string; userId: string }>(
  rows: T[],
  quota: number,
): Array<T & { label: string }> {
  const sorted = [...rows].sort(
    (a, b) => Number(b.totalScore) - Number(a.totalScore) || String(a.userId).localeCompare(String(b.userId)),
  );
  const n = sorted.length;
  const top = Math.min(quota, n);
  const bottomStart = Math.max(top, n - quota);
  return sorted.map((item, index) => ({
    ...item,
    label: index < top ? '优秀' : index >= bottomStart ? '不称职' : '正常',
  }));
}

@Injectable()
export class FinanceSettlementService implements OnModuleInit {
  constructor(
    @InjectRepository(Assessment) private readonly assessments: Repository<Assessment>,
    @InjectRepository(AssessmentEvent) private readonly events: Repository<AssessmentEvent>,
    @InjectRepository(MonthlySettlement) private readonly monthly: Repository<MonthlySettlement>,
    @InjectRepository(CasePerformance) private readonly ledgers: Repository<CasePerformance>,
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(CaseAssignment) private readonly assignments: Repository<CaseAssignment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
  ) {}

  /** 兼容关闭 DB_SYNC 的线上库：补齐案例关联 / 网格内名次字段 */
  async onModuleInit() {
    const eventCols = (await this.dataSource.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'assessment_event'
         AND column_name = 'service_case_id'`,
    )) as unknown[];
    if (!eventCols.length) {
      await this.dataSource.query(
        `ALTER TABLE assessment_event
         ADD COLUMN service_case_id bigint NULL REFERENCES service_case(id) ON DELETE SET NULL`,
      );
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_assessment_event_service_case
         ON assessment_event(service_case_id)`,
      );
    }
    const siteRankCols = (await this.dataSource.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'assessment'
         AND column_name = 'site_rank_result'`,
    )) as unknown[];
    if (!siteRankCols.length) {
      await this.dataSource.query(
        `ALTER TABLE assessment
         ADD COLUMN site_rank_result varchar(24) NULL`,
      );
    }
  }

  eventCatalog() {
    return ASSESSMENT_EVENT_CATALOG;
  }

  async listAssessments(
    month: string,
    user: CurrentUserContext,
    filters: { keyword?: string; siteId?: string; role?: 'site_manager' | 'inspector' } = {},
  ) {
    const people = await this.scope.listVisiblePeople(user, filters);
    const rows = people.length
      ? await this.assessments.find({ where: { month, userId: In(people.map((item) => item.id)) } })
      : [];
    const rowMap = new Map(rows.map((item) => [item.userId, item]));

    const personIds = people.map((person) => person.id);
    const primarySite = await this.scope.primarySiteIdByInspectors(personIds);
    const bySite = new Map<string, Array<{ userId: string; score: number }>>();
    for (const userId of personIds) {
      const siteId = filters.siteId || primarySite.get(userId);
      if (!siteId) continue;
      const assessment = rowMap.get(userId);
      if (!assessment) continue;
      // 纯网格长（未聘工程师）不参与网格内名次
      const person = people.find((p) => p.id === userId);
      const isMgr =
        !!person?.roles?.includes(UserRole.SITE_MANAGER) || person?.role === UserRole.SITE_MANAGER;
      const isInsp =
        !!person?.roles?.includes(UserRole.INSPECTOR) || person?.role === UserRole.INSPECTOR;
      if (isMgr && !isInsp) continue;
      if (isMgr && !primarySite.has(userId)) continue;
      const bucket = bySite.get(siteId) || [];
      bucket.push({ userId, score: Number(assessment.totalScore || assessment.internalScore || 0) });
      bySite.set(siteId, bucket);
    }
    const liveSiteRank = new Map<string, string>();
    for (const bucket of bySite.values()) {
      bucket
        .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId))
        .forEach((item, index) => liveSiteRank.set(item.userId, String(index + 1)));
    }
    const siteIds = [
      ...new Set(
        personIds
          .map((id) => filters.siteId || primarySite.get(id))
          .filter((id): id is string => !!id),
      ),
    ];
    const siteNames = await this.scope.siteNameMap(siteIds);

    return people.map((person) => {
      const saved = rowMap.get(person.id);
      const isManager =
        !!person.roles?.includes(UserRole.SITE_MANAGER) || person.role === UserRole.SITE_MANAGER;
      const isInspector =
        !!person.roles?.includes(UserRole.INSPECTOR) || person.role === UserRole.INSPECTOR;
      const siteId = primarySite.get(person.id) || filters.siteId || null;
      const siteRank =
        liveSiteRank.get(person.id) ||
        (saved?.siteRankResult && /^\d+$/.test(saved.siteRankResult) ? saved.siteRankResult : null);
      const userRole =
        isManager && isInspector ? 'dual' : isManager ? UserRole.SITE_MANAGER : UserRole.INSPECTOR;
      return {
        ...saved,
        userId: person.id,
        realName: person.realName,
        username: person.username,
        region: person.region,
        userRole,
        month,
        siteId: isInspector ? siteId : null,
        siteName: isInspector && siteId ? siteNames.get(siteId) || null : null,
        eventPenalty: saved?.eventPenalty || '0.00',
        siteRankResult: isInspector ? siteRank : null,
        rankResult: saved?.rankResult || null,
        rewardAmount: saved?.rewardAmount || '0.00',
      };
    });
  }

  async saveAssessment(dto: SaveAssessmentDto, user: CurrentUserContext) {
    const target = await this.users.findOne({ where: { id: dto.userId } });
    if (!target) throw new NotFoundException('考核人员不存在');
    if (user.role === UserRole.SITE_MANAGER && dto.userId === user.id) {
      throw new ForbiddenException('不能给自己打分，请由管理员录入本人考核');
    }
    await this.scope.assertPersonAccess(user, dto.userId);
    const isManager =
      !!target.roles?.includes(UserRole.SITE_MANAGER) || target.role === UserRole.SITE_MANAGER;
    const isInspector =
      !!target.roles?.includes(UserRole.INSPECTOR) || target.role === UserRole.INSPECTOR;
    // 兼工程师的网格长：全司奖罚进网格长池；网格内名次仍可按聘站工程师参与
    const targetRole = isManager ? UserRole.SITE_MANAGER : UserRole.INSPECTOR;
    const rankGroup = isManager ? 'station_manager' : 'inspector';
    if (user.role === UserRole.SITE_MANAGER && !isInspector) {
      throw new ForbiddenException('网格长只能录入本网格已聘工程师的考核');
    }
    let row = await this.assessments.findOne({ where: { month: dto.month, userId: dto.userId } });
    row ||= this.assessments.create({
      month: dto.month,
      userId: dto.userId,
      userRole: targetRole,
      rankGroup,
      eventPenalty: '0.00',
    });
    const before = row.id ? { ...row } : null;
    row.userRole = targetRole;
    row.rankGroup = rankGroup;
    row.internalScore = dto.internalScore.toFixed(2);
    row.sungrowScore = '0.00';
    row.totalScore = dto.internalScore.toFixed(2);
    row.toolSubsidy = (dto.toolSubsidy || 0).toFixed(2);
    row.otherSubsidy = (dto.otherSubsidy || 0).toFixed(2);
    row.subsidyRemark = dto.subsidyRemark || null;
    if (user.role === UserRole.SUPER_ADMIN && dto.rewardAmount !== undefined)
      row.rewardAmount = dto.rewardAmount.toFixed(2);
    row.updatedBy = user.id;
    const saved = await this.assessments.save(row);
    await this.syncEventPenalty(dto.month, dto.userId);
    await this.logs.write('assessment', saved.id, 'assessment', before, dto, user.id, '月度考核与补助录入');
    await this.refreshMonth(dto.month);
    return this.assessments.findOne({ where: { id: saved.id } });
  }

  async rank(month: string, dto: RankAssessmentDto, user: CurrentUserContext) {
    if (dto.mode === 'site_preview') {
      let siteIds: string[] = [];
      if (user.role === UserRole.SITE_MANAGER) {
        siteIds = user.managedSiteIds || [];
        if (!siteIds.length) throw new BadRequestException('未配置管辖网格，无法排名');
      } else if (user.role === UserRole.SUPER_ADMIN) {
        if (!dto.siteId) throw new BadRequestException('请先筛选网格后再生成网格内名次');
        siteIds = [dto.siteId];
      } else {
        throw new ForbiddenException('无权执行本网格排名');
      }
      const inspectorIds = await this.scope.inspectorIdsOfSites(siteIds);
      if (!inspectorIds.length) throw new BadRequestException('本网格暂无工程师可排名');
      // 含兼工程师的网格长（rankGroup 可能是 station_manager）
      const rows = await this.assessments.find({
        where: { month, userId: In(inspectorIds) },
        order: { totalScore: 'DESC', userId: 'ASC' },
      });
      if (!rows.length) throw new BadRequestException('请先为本网格工程师保存考核分数再排名');
      const sorted = [...rows].sort(
        (a, b) =>
          Number(b.totalScore) - Number(a.totalScore) || String(a.userId).localeCompare(String(b.userId)),
      );
      sorted.forEach((row, index) => {
        row.siteRankResult = String(index + 1);
      });
      await this.assessments.save(sorted);
      return sorted;
    }

    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('只有管理员可以执行全公司正式排名');
    }
    const group = dto.mode === 'company_managers' ? 'station_manager' : 'inspector';
    const quota = group === 'station_manager' ? 1 : 3;
    const qb = this.assessments
      .createQueryBuilder('a')
      .innerJoin(User, 'u', 'u.id = a.user_id')
      .where('a.month = :month', { month })
      .andWhere('a.rank_group = :group', { group })
      .orderBy('a.total_score', 'DESC')
      .addOrderBy('a.user_id', 'ASC');
    if (group === 'inspector') {
      // 兼网格长的人只进网格长池，不进工程师全司奖罚
      qb.andWhere('NOT (u.roles ? :mgr OR u.role = :mgrRole)', {
        mgr: UserRole.SITE_MANAGER,
        mgrRole: UserRole.SITE_MANAGER,
      });
    }
    const rows = await qb.getMany();
    if (!rows.length) {
      throw new BadRequestException(
        group === 'station_manager' ? '暂无网格长考核记录可排名' : '暂无工程师考核记录可排名',
      );
    }
    const labeled = applyPoolRankLabels(rows, quota);
    labeled.forEach((item) => {
      const row = rows.find((r) => r.userId === item.userId);
      if (!row) return;
      row.rankResult = item.label;
      row.rewardAmount = money(rankRewardAmount(group, item.label));
    });
    await this.assessments.save(rows);
    await this.refreshMonth(month);
    return rows;
  }

  /** 清空考核分数/排名/事件扣罚/月结草稿，便于复测；不影响案例与 PO。 */
  async clearAssessments(user: CurrentUserContext, confirm?: string) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可清空考核数据');
    }
    assertFinanceClearAllowed(confirm);
    const counts = await this.dataSource.transaction(async (em) => {
      const tables = ['assessment_event', 'monthly_settlement', 'assessment'] as const;
      const before: Record<string, number> = {};
      for (const table of tables) {
        const rows = (await em.query(`SELECT COUNT(*)::int AS count FROM ${table}`)) as Array<{
          count: number;
        }>;
        before[table] = Number(rows[0]?.count || 0);
      }
      await em.query('DELETE FROM assessment_event');
      await em.query('DELETE FROM monthly_settlement');
      await em.query('DELETE FROM assessment');
      return before;
    });
    await this.logs.write(
      'assessment',
      'all',
      'assessment_clear',
      counts,
      { deleted: counts },
      user.id,
      '清空考核、事件扣罚与月度结算草稿',
    );
    return {
      deleted: {
        assessmentEvent: counts.assessment_event,
        monthlySettlement: counts.monthly_settlement,
        assessment: counts.assessment,
      },
    };
  }

  async listEvents(
    month: string,
    user: CurrentUserContext,
    opts: { userId?: string; serviceCaseId?: string } = {},
  ) {
    const { userId, serviceCaseId } = opts;
    if (!serviceCaseId && !userId) {
      throw new BadRequestException('请指定人员或关联案例');
    }
    if (serviceCaseId) {
      const serviceCase = await this.cases.findOne({ where: { id: serviceCaseId } });
      if (!serviceCase) throw new NotFoundException('关联案例不存在');
      this.scope.assertCaseAccess(user, serviceCase);
    } else if (userId) {
      const target = await this.users.findOne({ where: { id: userId } });
      if (!target) throw new NotFoundException('考核人员不存在');
      await this.scope.assertPersonAccess(user, userId);
    }
    const rows = await this.events.find({
      where: serviceCaseId
        ? {
            month,
            serviceCaseId,
            ...(userId ? { userId } : {}),
          }
        : { month, userId: userId! },
      order: { createdAt: 'DESC' },
    });
    const nameIds = [...new Set(rows.map((row) => row.userId))];
    const people = nameIds.length
      ? await this.users.find({ where: { id: In(nameIds) } })
      : [];
    const nameMap = new Map(people.map((p) => [p.id, p.realName || p.username]));
    return rows.map((row) => ({
      ...row,
      userName: nameMap.get(row.userId) || null,
    }));
  }

  private async assertCaseAssignee(serviceCaseId: string, userId: string) {
    const serviceCase = await this.cases.findOne({ where: { id: serviceCaseId } });
    if (!serviceCase) throw new NotFoundException('关联案例不存在');
    const actives = await this.assignments.find({
      where: {
        serviceCaseId,
        status: In(['assigned', 'working', 'done']),
      },
    });
    const allowed = new Set(actives.map((a) => a.inspectorId));
    if (serviceCase.inspectorId) allowed.add(serviceCase.inspectorId);
    if (!allowed.size) {
      throw new BadRequestException('案例尚未派工程师，不能登记事件扣罚');
    }
    if (!allowed.has(userId)) {
      throw new BadRequestException('只能扣罚本案例在派的工程师，请先选择扣罚对象');
    }
    return serviceCase;
  }

  async createEvent(dto: CreateAssessmentEventDto, user: CurrentUserContext) {
    const target = await this.users.findOne({ where: { id: dto.userId } });
    if (!target) throw new NotFoundException('考核人员不存在');
    let serviceCaseId: string | null = dto.serviceCaseId || null;
    if (serviceCaseId) {
      const serviceCase = await this.assertCaseAssignee(serviceCaseId, dto.userId);
      this.scope.assertCaseAccess(user, serviceCase);
    } else {
      await this.scope.assertPersonAccess(user, dto.userId);
    }
    const catalog = ASSESSMENT_EVENT_CATALOG.find((item) => item.id === dto.catalogId);
    if (!catalog) throw new BadRequestException('考核细则不存在');
    const qty = dto.qty ?? 1;
    let amount = dto.amount;
    if (catalog.unitAmount == null) {
      if (amount == null || amount < 0) throw new BadRequestException('该细则需填写自定义扣罚金额');
    } else {
      amount = Math.round(catalog.unitAmount * qty * 100) / 100;
    }
    const saved = await this.events.save(
      this.events.create({
        month: dto.month,
        userId: dto.userId,
        serviceCaseId,
        category: catalog.category,
        content: catalog.content,
        unit: catalog.unit,
        qty: money(qty),
        unitAmount: catalog.unitAmount == null ? null : money(catalog.unitAmount),
        amount: money(amount!),
        remark: dto.remark || catalog.remark || null,
        createdBy: user.id,
      }),
    );
    await this.syncEventPenalty(dto.month, dto.userId);
    await this.refreshMonth(dto.month);
    return saved;
  }

  async deleteEvent(id: string, user: CurrentUserContext) {
    const row = await this.events.findOne({ where: { id } });
    if (!row) throw new NotFoundException('事件记录不存在');
    await this.scope.assertPersonAccess(user, row.userId);
    await this.events.delete({ id });
    await this.syncEventPenalty(row.month, row.userId);
    await this.refreshMonth(row.month);
    return { id };
  }

  async listMonthly(
    month: string,
    user: CurrentUserContext,
    filters: { keyword?: string; siteId?: string; role?: 'site_manager' | 'inspector' } = {},
  ) {
    await this.refreshMonth(month);
    const people = await this.scope.listVisiblePeople(user, filters);
    const rows = people.length
      ? await this.monthly.find({
          where: { month, userId: In(people.map((item) => item.id)) },
          order: { finalAmount: 'DESC' },
        })
      : [];
    const peopleMap = new Map(people.map((item) => [item.id, item]));
    return rows.map((row) => {
      const person = peopleMap.get(row.userId);
      return {
        ...row,
        user: person
          ? {
              id: person.id,
              username: person.username,
              realName: person.realName,
              region: person.region,
              orgUnit: person.orgUnit,
              role: person.role,
            }
          : undefined,
      };
    });
  }

  async correct(month: string, dto: CorrectMonthlyDto, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('只有管理员可以校正月度结算');
    await this.refreshMonth(month);
    const row = await this.monthly.findOne({ where: { month, userId: dto.userId } });
    if (!row) throw new NotFoundException('月度结算单不存在');
    if (row.status === 'locked') throw new BadRequestException('该月份已锁定，不能再修改');
    const before = row.correctionTotal;
    row.correctionTotal = dto.amount.toFixed(2);
    row.finalAmount = (
      Number(row.perfTotal) +
      Number(row.expenseTotal || 0) +
      Number(row.rewardTotal) +
      Number(row.subsidyTotal) +
      dto.amount -
      Number(row.eventPenalty || 0)
    ).toFixed(2);
    row.status = 'corrected';
    await this.monthly.save(row);
    let assessment = await this.assessments.findOne({ where: { month, userId: dto.userId } });
    const target = await this.users.findOne({ where: { id: dto.userId } });
    assessment ||= this.assessments.create({
      month,
      userId: dto.userId,
      userRole: target?.role || UserRole.INSPECTOR,
      rankGroup: target?.roles?.includes(UserRole.SITE_MANAGER) ? 'station_manager' : 'inspector',
      eventPenalty: '0.00',
    });
    assessment.correctionAmount = dto.amount.toFixed(2);
    assessment.correctionReason = dto.reason;
    assessment.updatedBy = user.id;
    await this.assessments.save(assessment);
    await this.logs.write(
      'monthly_settlement',
      row.id,
      'correction_total',
      before,
      row.correctionTotal,
      user.id,
      dto.reason,
    );
    return row;
  }

  async lock(month: string, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('只有管理员可以锁定月度结算');
    await this.refreshMonth(month);
    const rows = await this.monthly.find({ where: { month } });
    if (!rows.length) throw new BadRequestException('该月份暂无可锁定的结算数据');
    const now = new Date();
    rows.forEach((row) => {
      row.status = 'locked';
      row.lockedBy = user.id;
      row.lockedAt = now;
    });
    await this.monthly.save(rows);
    const ledgers = await this.ledgers.find({ where: { month, reviewStatus: 'approved' } });
    const caseIds = ledgers.map((item) => item.serviceCaseId);
    if (caseIds.length) {
      const cases = await this.cases.find({ where: { id: In(caseIds) } });
      cases.forEach((item) => (item.status = 'month_locked'));
      await this.cases.save(cases);
    }
    await this.logs.write('monthly_settlement', month, 'status', 'draft', 'locked', user.id, '管理员锁定月度结算');
    return { month, locked: rows.length };
  }

  async export(month: string, template: 'reconcile' | 'payroll', user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('只有管理员可以导出月度结算');
    const rows = await this.listMonthly(month, user);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(template === 'payroll' ? '发薪表' : '月度对账表');
    sheet.columns = [
      { header: '月份', key: 'month', width: 12 },
      { header: '姓名', key: 'name', width: 16 },
      { header: '账号', key: 'username', width: 16 },
      { header: '计件绩效', key: 'perf', width: 15 },
      { header: '行程报销', key: 'expense', width: 15 },
      { header: '排名奖罚', key: 'reward', width: 15 },
      { header: '事件扣罚', key: 'eventPenalty', width: 15 },
      { header: '补助', key: 'subsidy', width: 15 },
      { header: '校正增补', key: 'correction', width: 15 },
      { header: '最终金额', key: 'final', width: 15 },
      { header: '状态', key: 'status', width: 12 },
    ];
    rows.forEach((row) =>
      sheet.addRow({
        month: row.month,
        name: row.user?.realName || '-',
        username: row.user?.username || '-',
        perf: Number(row.perfTotal),
        expense: Number(row.expenseTotal || 0),
        reward: Number(row.rewardTotal),
        eventPenalty: Number(row.eventPenalty || 0),
        subsidy: Number(row.subsidyTotal),
        correction: Number(row.correctionTotal),
        final: Number(row.finalAmount),
        status: row.status === 'locked' ? '已锁定' : row.status === 'corrected' ? '已校正' : '草稿',
      }),
    );
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: 'K1' };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async syncEventPenalty(month: string, userId: string) {
    const raw = await this.events
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.amount),0)', 'total')
      .where('e.month=:month AND e.user_id=:userId', { month, userId })
      .getRawOne<{ total: string }>();
    let assessment = await this.assessments.findOne({ where: { month, userId } });
    if (!assessment) {
      const target = await this.users.findOne({ where: { id: userId } });
      assessment = this.assessments.create({
        month,
        userId,
        userRole: target?.roles?.includes(UserRole.SITE_MANAGER)
          ? UserRole.SITE_MANAGER
          : UserRole.INSPECTOR,
        rankGroup: target?.roles?.includes(UserRole.SITE_MANAGER) ? 'station_manager' : 'inspector',
        internalScore: '0.00',
        sungrowScore: '0.00',
        totalScore: '0.00',
      });
    }
    assessment.eventPenalty = money(Number(raw?.total || 0));
    await this.assessments.save(assessment);
  }

  private async refreshMonth(month: string) {
    const [approved, assessmentRows, existing, expenseRows, shareRows] = await Promise.all([
      this.ledgers.find({ where: { month, reviewStatus: 'approved' } }),
      this.assessments.find({ where: { month } }),
      this.monthly.find({ where: { month } }),
      this.dataSource.query(
        `SELECT inspector_id AS "inspectorId", COALESCE(SUM(amount),0)::float AS total
         FROM case_expense_claim
         WHERE status='approved' AND month=$1
         GROUP BY inspector_id`,
        [month],
      ) as Promise<Array<{ inspectorId: string; total: number }>>,
      this.dataSource.query(
        `SELECT s.inspector_id AS "inspectorId", COALESCE(SUM(s.perf_amount),0)::float AS total
         FROM case_perf_share s
         INNER JOIN case_performance p ON p.service_case_id = s.service_case_id
         WHERE p.month=$1 AND p.review_status='approved'
         GROUP BY s.inspector_id`,
        [month],
      ) as Promise<Array<{ inspectorId: string; total: number }>>,
    ]);
    const userIds = [
      ...new Set(
        [
          ...approved.map((item) => item.inspectorId),
          ...assessmentRows.map((item) => item.userId),
          ...expenseRows.map((item) => item.inspectorId),
          ...shareRows.map((item) => item.inspectorId),
        ].filter(Boolean) as string[],
      ),
    ];
    const ledgerByUser = new Map<string, number>();
    // 优先用分账；无分账时回退总账 inspectorId
    shareRows.forEach((item) => ledgerByUser.set(item.inspectorId, Number(item.total || 0)));
    approved.forEach((item) => {
      if (!item.inspectorId) return;
      if (!ledgerByUser.has(item.inspectorId)) {
        ledgerByUser.set(item.inspectorId, Number(item.perfFinal));
      }
    });
    const expenseByUser = new Map<string, number>();
    expenseRows.forEach((item) => expenseByUser.set(item.inspectorId, Number(item.total || 0)));
    const assessmentMap = new Map(assessmentRows.map((item) => [item.userId, item]));
    const existingMap = new Map(existing.map((item) => [item.userId, item]));
    const changed: MonthlySettlement[] = [];
    userIds.forEach((userId) => {
      let row = existingMap.get(userId);
      if (row?.status === 'locked') return;
      row ||= this.monthly.create({ month, userId, eventPenalty: '0.00', expenseTotal: '0.00' });
      const assessment = assessmentMap.get(userId);
      row.perfTotal = (ledgerByUser.get(userId) || 0).toFixed(2);
      row.expenseTotal = (expenseByUser.get(userId) || 0).toFixed(2);
      row.rewardTotal = Number(assessment?.rewardAmount || 0).toFixed(2);
      row.eventPenalty = Number(assessment?.eventPenalty || 0).toFixed(2);
      row.subsidyTotal = (
        Number(assessment?.toolSubsidy || 0) + Number(assessment?.otherSubsidy || 0)
      ).toFixed(2);
      row.correctionTotal = Number(assessment?.correctionAmount || row.correctionTotal || 0).toFixed(
        2,
      );
      row.finalAmount = (
        Number(row.perfTotal) +
        Number(row.expenseTotal) +
        Number(row.rewardTotal) +
        Number(row.subsidyTotal) +
        Number(row.correctionTotal) -
        Number(row.eventPenalty)
      ).toFixed(2);
      if (row.status !== 'corrected') row.status = 'draft';
      changed.push(row);
    });
    if (changed.length) await this.monthly.save(changed);
  }

  /** 供报销审核等外部触发月结刷新 */
  async refreshMonthPublic(month: string) {
    return this.refreshMonth(month);
  }
}
