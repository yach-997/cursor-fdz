import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import ExcelJS from 'exceljs';
import {
  Assessment,
  AssessmentEvent,
  CasePerformance,
  MonthlySettlement,
  ServiceCase,
  User,
} from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import { CommonStatus, UserRole } from '../../../common/enums';
import {
  CorrectMonthlyDto,
  CreateAssessmentEventDto,
  SaveAssessmentDto,
} from '../dto/finance.dto';
import { FinanceScopeService } from './finance-scope.service';
import { ChangeLogService } from './change-log.service';
import { ASSESSMENT_EVENT_CATALOG, rankRewardAmount } from './assessment-event.catalog';

const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

@Injectable()
export class FinanceSettlementService {
  constructor(
    @InjectRepository(Assessment) private readonly assessments: Repository<Assessment>,
    @InjectRepository(AssessmentEvent) private readonly events: Repository<AssessmentEvent>,
    @InjectRepository(MonthlySettlement) private readonly monthly: Repository<MonthlySettlement>,
    @InjectRepository(CasePerformance) private readonly ledgers: Repository<CasePerformance>,
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
  ) {}

  eventCatalog() {
    return ASSESSMENT_EVENT_CATALOG;
  }

  async listAssessments(month: string, user: CurrentUserContext) {
    const people = await this.scopedPeople(user);
    const rows = people.length
      ? await this.assessments.find({ where: { month, userId: In(people.map((item) => item.id)) } })
      : [];
    const rowMap = new Map(rows.map((item) => [item.userId, item]));
    return people.map((person) => ({
      ...rowMap.get(person.id),
      userId: person.id,
      realName: person.realName,
      username: person.username,
      region: person.region,
      userRole: person.roles?.includes(UserRole.SITE_MANAGER)
        ? UserRole.SITE_MANAGER
        : UserRole.INSPECTOR,
      month,
      eventPenalty: rowMap.get(person.id)?.eventPenalty || '0.00',
    }));
  }

  async saveAssessment(dto: SaveAssessmentDto, user: CurrentUserContext) {
    const target = await this.users.findOne({ where: { id: dto.userId } });
    if (!target) throw new NotFoundException('考核人员不存在');
    await this.scope.assertRegion(user, target.region);
    const targetRole = target.roles?.includes(UserRole.SITE_MANAGER)
      ? UserRole.SITE_MANAGER
      : UserRole.INSPECTOR;
    let row = await this.assessments.findOne({ where: { month: dto.month, userId: dto.userId } });
    row ||= this.assessments.create({
      month: dto.month,
      userId: dto.userId,
      userRole: targetRole,
      rankGroup: targetRole === UserRole.SITE_MANAGER ? 'station_manager' : 'inspector',
      eventPenalty: '0.00',
    });
    const before = row.id ? { ...row } : null;
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

  async rank(month: string, user: CurrentUserContext) {
    const region = await this.scope.region(user);
    const qb = this.assessments
      .createQueryBuilder('a')
      .innerJoin(User, 'u', 'u.id=a.user_id')
      .where('a.month=:month', { month });
    if (region) qb.andWhere('u.region=:region', { region });
    const rows = await qb.orderBy('a.total_score', 'DESC').addOrderBy('a.user_id', 'ASC').getMany();
    for (const group of ['station_manager', 'inspector'] as const) {
      const grouped = rows.filter((item) => item.rankGroup === group);
      const quota = group === 'station_manager' ? 1 : 3;
      grouped.forEach((item, index) => {
        item.rankResult =
          index < quota
            ? '优秀'
            : index >= Math.max(quota, grouped.length - quota)
              ? '不称职'
              : '正常';
        item.rewardAmount = money(rankRewardAmount(group, item.rankResult));
      });
    }
    await this.assessments.save(rows);
    await this.refreshMonth(month);
    return rows;
  }

  async listEvents(month: string, userId: string, user: CurrentUserContext) {
    const target = await this.users.findOne({ where: { id: userId } });
    if (!target) throw new NotFoundException('考核人员不存在');
    await this.scope.assertRegion(user, target.region);
    return this.events.find({ where: { month, userId }, order: { createdAt: 'DESC' } });
  }

  async createEvent(dto: CreateAssessmentEventDto, user: CurrentUserContext) {
    const target = await this.users.findOne({ where: { id: dto.userId } });
    if (!target) throw new NotFoundException('考核人员不存在');
    await this.scope.assertRegion(user, target.region);
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
    const target = await this.users.findOne({ where: { id: row.userId } });
    await this.scope.assertRegion(user, target?.region || null);
    await this.events.delete({ id });
    await this.syncEventPenalty(row.month, row.userId);
    await this.refreshMonth(row.month);
    return { id };
  }

  async listMonthly(month: string, user: CurrentUserContext) {
    await this.refreshMonth(month);
    const people = await this.scopedPeople(user);
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
        reward: Number(row.rewardTotal),
        eventPenalty: Number(row.eventPenalty || 0),
        subsidy: Number(row.subsidyTotal),
        correction: Number(row.correctionTotal),
        final: Number(row.finalAmount),
        status: row.status === 'locked' ? '已锁定' : row.status === 'corrected' ? '已校正' : '草稿',
      }),
    );
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: 'J1' };
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
    const [approved, assessmentRows, existing] = await Promise.all([
      this.ledgers.find({ where: { month, reviewStatus: 'approved' } }),
      this.assessments.find({ where: { month } }),
      this.monthly.find({ where: { month } }),
    ]);
    const userIds = [
      ...new Set(
        [
          ...approved.map((item) => item.inspectorId),
          ...assessmentRows.map((item) => item.userId),
        ].filter(Boolean) as string[],
      ),
    ];
    const ledgerByUser = new Map<string, number>();
    approved.forEach((item) =>
      ledgerByUser.set(
        item.inspectorId!,
        (ledgerByUser.get(item.inspectorId!) || 0) + Number(item.perfFinal),
      ),
    );
    const assessmentMap = new Map(assessmentRows.map((item) => [item.userId, item]));
    const existingMap = new Map(existing.map((item) => [item.userId, item]));
    const changed: MonthlySettlement[] = [];
    userIds.forEach((userId) => {
      let row = existingMap.get(userId);
      if (row?.status === 'locked') return;
      row ||= this.monthly.create({ month, userId, eventPenalty: '0.00' });
      const assessment = assessmentMap.get(userId);
      row.perfTotal = (ledgerByUser.get(userId) || 0).toFixed(2);
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

  private async scopedPeople(user: CurrentUserContext) {
    const region = await this.scope.region(user);
    const qb = this.users
      .createQueryBuilder('u')
      .where('u.status=:status', { status: CommonStatus.ACTIVE });
    qb.andWhere('(u.roles ? :manager OR u.roles ? :inspector OR u.role IN (:...roles))', {
      manager: UserRole.SITE_MANAGER,
      inspector: UserRole.INSPECTOR,
      roles: [UserRole.SITE_MANAGER, UserRole.INSPECTOR],
    });
    if (region) qb.andWhere('u.region=:region', { region });
    return qb.orderBy('u.real_name', 'ASC').getMany();
  }
}
