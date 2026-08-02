import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CasePerformance,
  CaseWorkRecord,
  Device,
  InspectionRecord,
  InspectionTask,
  InspectionTemplate,
  PoItem,
  PoOrder,
  ServiceCase,
  TemplateEntry,
  User,
  Assessment,
  MonthlySettlement,
  SiteMember,
} from '../../../entities';
import {
  CommonStatus,
  DeviceStatus,
  SiteMemberRole,
  TaskStatus,
  UserRole,
  WorkTaskType,
} from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { userHasRole } from '../../../common/utils/user-roles';
import {
  DeductionDto,
  SaveCaseWorkDto,
} from '../dto/finance.dto';
import { ChangeLogService } from './change-log.service';
import { FinanceScopeService } from './finance-scope.service';
import { TaskService } from '../../task/task.service';

const ACTIVE_CASE_STATUSES = ['assigned', 'working'] as const;

export type CaseChecklistItem = {
  entryId: string;
  name: string;
  description: string;
  isRequired: boolean;
  isOptionalModule: boolean;
  /** 可选分项是否开启；必检项恒为 true */
  enabled: boolean;
  done: boolean;
  photoUrls: string[];
  note: string;
  order: number;
};

@Injectable()
export class FinanceWorkflowService {
  constructor(
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(CaseWorkRecord) private readonly work: Repository<CaseWorkRecord>,
    @InjectRepository(CasePerformance) private readonly ledgers: Repository<CasePerformance>,
    @InjectRepository(PoOrder) private readonly orders: Repository<PoOrder>,
    @InjectRepository(PoItem) private readonly items: Repository<PoItem>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Assessment) private readonly assessments: Repository<Assessment>,
    @InjectRepository(MonthlySettlement) private readonly monthly: Repository<MonthlySettlement>,
    @InjectRepository(SiteMember) private readonly members: Repository<SiteMember>,
    @InjectRepository(InspectionTemplate)
    private readonly templates: Repository<InspectionTemplate>,
    @InjectRepository(InspectionTask) private readonly tasks: Repository<InspectionTask>,
    @InjectRepository(InspectionRecord) private readonly records: Repository<InspectionRecord>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly taskService: TaskService,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
  ) {}

  async availableInspectors(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    const inspectors = await this.users.find({
      where: { status: CommonStatus.ACTIVE },
      order: { realName: 'ASC' },
    });
    const activeCountByInspector = new Map<string, number>();
    const activeRows = await this.cases.find({
      where: { status: In([...ACTIVE_CASE_STATUSES]) },
      select: { inspectorId: true },
    });
    for (const row of activeRows) {
      if (!row.inspectorId) continue;
      activeCountByInspector.set(
        row.inspectorId,
        (activeCountByInspector.get(row.inspectorId) || 0) + 1,
      );
    }
    let siteMemberIds: Set<string> | null = null;
    if (serviceCase.siteId) {
      const members = await this.members.find({
        where: {
          siteId: serviceCase.siteId,
          status: CommonStatus.ACTIVE,
          memberRole: SiteMemberRole.INSPECTOR,
        },
      });
      siteMemberIds = new Set(members.map((m) => m.userId));
    }
    // 派单只看「本站已入职工程师」；允许一人多案，available 恒为 true
    return inspectors
      .filter((item) => userHasRole(item, UserRole.INSPECTOR))
      .filter((item) => !siteMemberIds || siteMemberIds.has(item.id))
      .map((item) => ({
        id: item.id,
        realName: item.realName,
        phone: item.phone,
        region: item.region,
        available: true,
        activeCaseCount: activeCountByInspector.get(item.id) || 0,
      }));
  }

  async assign(caseId: string, inspectorId: string, reason: string | undefined, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    const isReassign = ['assigned', 'working'].includes(serviceCase.status);
    if (!isReassign && serviceCase.status !== 'pending_assign') {
      throw new BadRequestException('当前状态不可派单或改派工程师');
    }
    if (!serviceCase.siteId) {
      throw new BadRequestException('请先将案例分配到站点，再派给本站工程师');
    }
    if (!serviceCase.taskTemplateId && !serviceCase.taskType) {
      throw new BadRequestException('请先设置案例任务类型');
    }
    if (isReassign) {
      await this.assertInspectionTransferable(caseId);
    }
    const inspector = await this.users.findOne({ where: { id: inspectorId } });
    if (!inspector || inspector.status !== CommonStatus.ACTIVE || !userHasRole(inspector, UserRole.INSPECTOR)) {
      throw new BadRequestException('所选账号不是可用工程师');
    }
    const member = await this.members.findOne({
      where: {
        siteId: serviceCase.siteId,
        userId: inspectorId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.INSPECTOR,
      },
    });
    if (!member) {
      throw new BadRequestException('只能派给该站点已入职的工程师');
    }
    if (isReassign && serviceCase.inspectorId === inspectorId) {
      throw new BadRequestException('已是该工程师，无需改派');
    }

    const before = { status: serviceCase.status, inspectorId: serviceCase.inspectorId };
    // 改派时保留作业中状态；首次派单进入已派单
    if (!isReassign) serviceCase.status = 'assigned';
    serviceCase.inspectorId = inspectorId;
    serviceCase.assignBy = user.id;
    serviceCase.assignTime = new Date();
    await this.cases.save(serviceCase);

    let work = await this.work.findOne({ where: { serviceCaseId: caseId } });
    work ||= this.work.create({
      serviceCaseId: caseId,
      gspCaseNo: serviceCase.gspCaseNo,
      inspectorId,
      workload: {},
      mileage: '0.00',
      expenses: '0.00',
      mileageScreenshotUrls: [],
      acceptedAt: new Date(),
    });
    work.inspectorId = inspectorId;
    work.acceptedAt = work.acceptedAt || new Date();
    await this.work.save(work);

    await this.ledgers.update({ serviceCaseId: caseId }, { inspectorId });
    await this.ensureInspectionTask(serviceCase, inspectorId, user.id);
    await this.logs.write(
      'service_case',
      caseId,
      'assignment',
      before,
      { status: serviceCase.status, inspectorId },
      user.id,
      reason?.trim()
        ? `${isReassign ? '改派工程师' : '站点派单'}：${reason.trim()}`
        : isReassign
          ? `改派工程师 → ${inspector.realName}`
          : '站点派单',
    );
    return serviceCase;
  }

  /** 巡检报告已提交后禁止改派站点/工程师 */
  async assertInspectionTransferable(caseId: string) {
    const task = await this.tasks.findOne({ where: { serviceCaseId: caseId } });
    if (
      task &&
      [TaskStatus.SUBMITTED, TaskStatus.APPROVED].includes(task.status as TaskStatus)
    ) {
      throw new BadRequestException('巡检报告已提交，不能再改派');
    }
    return task;
  }

  /**
   * 改派站点时：清空原工程师派单，并删除未提交的巡检任务，供新站点重新派单。
   */
  async resetDispatchForSiteTransfer(serviceCase: ServiceCase) {
    await this.assertInspectionTransferable(serviceCase.id);
    const task = await this.tasks.findOne({ where: { serviceCaseId: serviceCase.id } });
    if (task) {
      await this.records.delete({ taskId: task.id });
      await this.tasks.delete(task.id);
    }
    await this.work.delete({ serviceCaseId: serviceCase.id });
    await this.ledgers.update({ serviceCaseId: serviceCase.id }, { inspectorId: null });
  }

  async myCases(user: CurrentUserContext) {
    this.assertInspector(user);
    const list = await this.cases.find({
      where: { inspectorId: user.id },
      order: { updatedAt: 'DESC' },
    });
    const records = list.length
      ? await this.work.find({ where: { serviceCaseId: In(list.map((item) => item.id)) } })
      : [];
    const workMap = new Map(records.map((item) => [item.serviceCaseId, item]));
    const templateIds = [...new Set(list.map((item) => item.taskTemplateId).filter(Boolean))];
    const nameMap = new Map<string, string>();
    if (templateIds.length) {
      const rows = await this.cases.manager.query(
        `SELECT id, name FROM inspection_templates WHERE id = ANY($1::uuid[])`,
        [templateIds],
      );
      for (const row of rows) nameMap.set(row.id, row.name);
    }
    const legacyLabel: Record<string, string> = {
      inspection: '巡检',
      service: '服务作业',
    };
    return list.map((item) => ({
      ...item,
      taskTypeName:
        (item.taskTemplateId && nameMap.get(item.taskTemplateId)) ||
        legacyLabel[String(item.taskType || '')] ||
        item.taskType ||
        null,
      workRecord: workMap.get(item.id) || null,
    }));
  }

  async myCase(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForInspector(caseId, user);
    const [workRecord, orders, template, inspectionTask] = await Promise.all([
      this.work.findOne({ where: { serviceCaseId: caseId } }),
      this.orders.find({ where: { serviceCaseId: caseId }, order: { demandDate: 'DESC' } }),
      serviceCase.taskTemplateId
        ? this.templates.findOne({ where: { id: serviceCase.taskTemplateId } })
        : Promise.resolve(null),
      this.tasks.findOne({ where: { serviceCaseId: caseId } }),
    ]);
    const checklist = this.readChecklist(workRecord) || this.buildChecklist(template?.entries || []);
    const inspectionDone = !!inspectionTask &&
      [TaskStatus.SUBMITTED, TaskStatus.APPROVED].includes(inspectionTask.status as TaskStatus);
    return {
      ...serviceCase,
      taskTypeName: template?.name || serviceCase.taskType || null,
      taskEntries: (template?.entries || []).slice().sort((a, b) => a.order - b.order),
      checklist,
      workRecord,
      orders,
      inspectionTaskId: inspectionTask?.id || null,
      inspectionTaskStatus: inspectionTask?.status || null,
      inspectionDone,
    };
  }

  async start(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForInspector(caseId, user);
    if (!['assigned', 'working'].includes(serviceCase.status)) {
      throw new BadRequestException('当前案例不能开始作业');
    }
    if (!serviceCase.taskTemplateId && !serviceCase.taskType) {
      throw new BadRequestException('案例未设置任务类型，无法开始巡检');
    }
    const fromStatus = serviceCase.status;
    if (serviceCase.status === 'assigned') {
      serviceCase.status = 'working';
      await this.cases.save(serviceCase);
    }
    let record = await this.work.findOne({ where: { serviceCaseId: caseId } });
    record ||= this.work.create({
      serviceCaseId: caseId,
      gspCaseNo: serviceCase.gspCaseNo,
      inspectorId: user.id,
      workload: {},
      mileage: '0.00',
      expenses: '0.00',
      mileageScreenshotUrls: [],
      acceptedAt: new Date(),
    });
    if (!record.startedAt) record.startedAt = new Date();
    await this.work.save(record);

    const task = await this.ensureInspectionTask(serviceCase, user.id, user.id);
    if (
      task.status === TaskStatus.PENDING ||
      task.status === TaskStatus.REJECTED
    ) {
      await this.taskService.start(task.id, user);
    }

    if (fromStatus === 'assigned') {
      await this.logs.write(
        'service_case',
        caseId,
        'status',
        'assigned',
        'working',
        user.id,
        '工程师开始作业',
      );
    }
    return this.myCase(caseId, user);
  }

  /**
   * 为费用案例创建/复用带 AI 的规范巡检任务（模板快照来自任务类型）。
   * 使用案例号生成占位设备，不依赖现场台账录入。
   */
  async ensureInspectionTask(
    serviceCase: ServiceCase,
    inspectorId: string,
    createdBy: string,
  ): Promise<InspectionTask> {
    if (!serviceCase.siteId) {
      throw new BadRequestException('案例未分配站点，无法创建巡检任务');
    }
    if (!serviceCase.taskTemplateId) {
      throw new BadRequestException('案例未设置任务类型，无法创建巡检任务');
    }

    const existing = await this.tasks.findOne({
      where: { serviceCaseId: serviceCase.id },
    });
    if (existing) {
      if (
        inspectorId &&
        existing.inspectorId !== inspectorId &&
        ![TaskStatus.SUBMITTED, TaskStatus.APPROVED].includes(existing.status as TaskStatus)
      ) {
        existing.inspectorId = inspectorId;
        await this.tasks.save(existing);
      }
      return existing;
    }

    const template = await this.templates.findOne({
      where: { id: serviceCase.taskTemplateId },
    });
    if (!template?.entries?.length) {
      throw new BadRequestException('任务类型模板不存在或没有检查条目');
    }

    const serialBase = `CASE-${serviceCase.gspCaseNo}`.slice(0, 60);
    let device = await this.devices.findOne({ where: { serialNumber: serialBase } });
    if (!device) {
      device = await this.devices.save(
        this.devices.create({
          siteId: serviceCase.siteId,
          serialNumber: serialBase,
          deviceType: template.deviceType,
          model: template.name,
          manufacturer: '案例巡检',
          status: DeviceStatus.ACTIVE,
        }),
      );
    } else if (device.siteId !== serviceCase.siteId) {
      const serial = `${serialBase}-${serviceCase.id}`.slice(0, 64);
      device = await this.devices.save(
        this.devices.create({
          siteId: serviceCase.siteId,
          serialNumber: serial,
          deviceType: template.deviceType,
          model: template.name,
          manufacturer: '案例巡检',
          status: DeviceStatus.ACTIVE,
        }),
      );
    }

    return this.tasks.save(
      this.tasks.create({
        siteId: serviceCase.siteId,
        deviceId: device.id,
        taskName: `${serviceCase.gspCaseNo}-${serviceCase.projectName || '巡检'}`.slice(0, 120),
        inspectorId,
        createdBy,
        serviceCaseId: serviceCase.id,
        taskType: WorkTaskType.INSPECTION,
        status: TaskStatus.PENDING,
        plannedDate: null,
        aiEnabled: true,
        templateSnapshot: template.entries,
      } as Partial<InspectionTask>),
    );
  }

  async saveWork(caseId: string, dto: SaveCaseWorkDto, user: CurrentUserContext) {
    const serviceCase = await this.caseForInspector(caseId, user);
    if (!['assigned', 'working'].includes(serviceCase.status)) {
      throw new BadRequestException('当前案例不能修改工作记录');
    }
    let record = await this.work.findOne({ where: { serviceCaseId: caseId } });
    record ||= this.work.create({
      serviceCaseId: caseId,
      gspCaseNo: serviceCase.gspCaseNo,
      inspectorId: user.id,
      workload: {},
      mileage: '0.00',
      expenses: '0.00',
      mileageScreenshotUrls: [],
      acceptedAt: new Date(),
    });
    if (dto.workload !== undefined) {
      const incoming = dto.workload || {};
      const prev = (record.workload || {}) as Record<string, unknown>;
      const nextChecklist = Array.isArray((incoming as any).checklist)
        ? this.normalizeChecklist((incoming as any).checklist)
        : this.readChecklist(record) || [];
      record.workload = {
        ...prev,
        ...incoming,
        checklist: nextChecklist,
      };
    }
    if (dto.mileage !== undefined) record.mileage = dto.mileage.toFixed(2);
    if (dto.expenses !== undefined) record.expenses = dto.expenses.toFixed(2);
    if (dto.expenseNote !== undefined) record.expenseNote = dto.expenseNote;
    if (dto.mileageScreenshotUrls !== undefined)
      record.mileageScreenshotUrls = dto.mileageScreenshotUrls.slice(0, 9);
    if (dto.workNote !== undefined) record.workNote = dto.workNote;
    return this.work.save(record);
  }

  async finish(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForInspector(caseId, user);
    if (serviceCase.status !== 'working') throw new BadRequestException('请先开始作业再完工');
    const record = await this.work.findOne({ where: { serviceCaseId: caseId } });
    if (!record) throw new BadRequestException('请先完成巡检与工作记录');
    const inspectionTask = await this.tasks.findOne({ where: { serviceCaseId: caseId } });
    if (inspectionTask) {
      if (
        ![TaskStatus.SUBMITTED, TaskStatus.APPROVED].includes(
          inspectionTask.status as TaskStatus,
        )
      ) {
        throw new BadRequestException('请先完成并提交巡检报告后再确认完工');
      }
    } else {
      const checklist = this.readChecklist(record) || [];
      if (checklist.length) {
        const pending = checklist.filter(
          (item) => item.enabled && (item.isRequired || item.isOptionalModule) && !item.done,
        );
        if (pending.length) {
          throw new BadRequestException(
            `还有 ${pending.length} 个检查条目未完成：${pending
              .slice(0, 3)
              .map((x) => x.name)
              .join('、')}`,
          );
        }
      }
    }
    // 里程/费用报销暂不强制，工程师自行报销；闭环以巡检报告提交为准
    const hasPo = (await this.orders.count({ where: { serviceCaseId: caseId } })) > 0;
    serviceCase.status = hasPo ? 'settle_review' : 'finished';
    serviceCase.finishTime = new Date();
    await this.cases.save(serviceCase);
    record.completedAt = new Date();
    await this.work.save(record);
    if (hasPo) await this.refreshLedger(serviceCase, true);
    await this.logs.write('service_case', caseId, 'status', 'working', serviceCase.status, user.id, '工程师完工确认');
    return serviceCase;
  }

  private buildChecklist(entries: TemplateEntry[]): CaseChecklistItem[] {
    return [...entries]
      .sort((a, b) => a.order - b.order)
      .map((entry, index) => ({
        entryId: entry.id || `entry-${index}`,
        name: entry.name,
        description: entry.description || '',
        isRequired: entry.isRequired !== false && !entry.isOptionalModule,
        isOptionalModule: !!entry.isOptionalModule,
        enabled: !entry.isOptionalModule,
        done: false,
        photoUrls: [],
        note: '',
        order: entry.order ?? index,
      }));
  }

  private readChecklist(record?: CaseWorkRecord | null): CaseChecklistItem[] | null {
    const raw = (record?.workload as any)?.checklist;
    if (!Array.isArray(raw) || !raw.length) return null;
    return this.normalizeChecklist(raw);
  }

  private normalizeChecklist(raw: any[]): CaseChecklistItem[] {
    return raw.map((item, index) => ({
      entryId: String(item.entryId || item.id || `entry-${index}`),
      name: String(item.name || `条目${index + 1}`),
      description: String(item.description || ''),
      isRequired: item.isRequired !== false && !item.isOptionalModule,
      isOptionalModule: !!item.isOptionalModule,
      enabled: item.isOptionalModule ? !!item.enabled : true,
      done: !!item.done,
      photoUrls: Array.isArray(item.photoUrls)
        ? item.photoUrls.map(String).filter(Boolean).slice(0, 9)
        : [],
      note: String(item.note || ''),
      order: Number(item.order ?? index),
    }));
  }

  async pendingReview(user: CurrentUserContext) {
    const qb = this.cases
      .createQueryBuilder('c')
      .innerJoin(CasePerformance, 'p', 'p.service_case_id=c.id')
      .leftJoin(User, 'u', 'u.id=c.inspector_id')
      .select([
        'c.id AS id',
        'c.gsp_case_no AS "gspCaseNo"',
        'c.project_name AS "projectName"',
        'c.region AS region',
        'c.finish_time AS "finishTime"',
        'c.status AS status',
        'u.real_name AS "inspectorName"',
        'p.perf_base AS "perfBase"',
        'p.deduction AS deduction',
        'p.perf_final AS "perfFinal"',
        'p.case_revenue AS "caseRevenue"',
        'p.review_status AS "reviewStatus"',
        'p.deduction_status AS "deductionStatus"',
        `(SELECT COUNT(*) FROM po_item pi
          INNER JOIN po_order po ON po.id=pi.po_id
          WHERE po.service_case_id=c.id
            AND pi.price_status <> 'ignored'
            AND pi.perf_price IS NULL) AS "missingPerf"`,
      ])
      .where("c.status IN ('settle_review','settled')")
      .andWhere("p.review_status IN ('pending','rejected')");
    if (user.role === UserRole.SITE_MANAGER) {
      if (!user.managedSiteIds?.length) return [];
      qb.andWhere('(c.site_id IN (:...siteIds) OR c.site_id IS NULL)', {
        siteIds: user.managedSiteIds,
      });
    }
    const rows = await qb.orderBy('c.finish_time', 'ASC').getRawMany();
    return rows.map((row) => {
      const dueAt = row.finishTime
        ? new Date(new Date(row.finishTime).getTime() + 7 * 86400000)
        : null;
      return {
        ...row,
        missingPerf: Number(row.missingPerf || 0),
        approvalReady: !!row.inspectorName && Number(row.missingPerf || 0) === 0,
        dueAt,
        overdue: !!dueAt && dueAt.getTime() < Date.now(),
        remainingHours: dueAt ? Math.ceil((dueAt.getTime() - Date.now()) / 3600000) : null,
      };
    });
  }

  async approve(caseId: string, comment: string | undefined, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    if (serviceCase.status !== 'settle_review') throw new BadRequestException('当前案例不在待结算审核状态');
    if (!serviceCase.inspectorId) throw new BadRequestException('案例尚未关联工程师，不能审核结算');
    const missingPerf = await this.items
      .createQueryBuilder('item')
      .innerJoin(PoOrder, 'po', 'po.id=item.po_id')
      .where('po.service_case_id=:caseId', { caseId })
      .andWhere("item.price_status <> 'ignored'")
      .andWhere('item.perf_price IS NULL')
      .getCount();
    if (missingPerf > 0) throw new BadRequestException(`仍有 ${missingPerf} 个条目未配置内部绩效价`);
    const ledger = await this.refreshLedger(serviceCase);
    if (ledger.deductionStatus === 'pending') throw new BadRequestException('特殊扣减尚待管理员复核');
    ledger.reviewStatus = 'approved';
    ledger.reviewerId = user.id;
    ledger.reviewTime = new Date();
    ledger.reviewComment = comment || null;
    await this.ledgers.save(ledger);
    serviceCase.status = 'settled';
    await this.cases.save(serviceCase);
    await this.logs.write('case_performance', ledger.id, 'review_status', 'pending', 'approved', user.id, comment || '结算审核通过');
    return ledger;
  }

  async reject(caseId: string, reason: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    if (serviceCase.status !== 'settle_review') throw new BadRequestException('当前案例不在待结算审核状态');
    const ledger = await this.ledger(caseId);
    ledger.reviewStatus = 'rejected';
    ledger.reviewerId = user.id;
    ledger.reviewTime = new Date();
    ledger.reviewComment = reason;
    await this.ledgers.save(ledger);
    await this.logs.write('case_performance', ledger.id, 'review_status', 'pending', 'rejected', user.id, reason);
    return ledger;
  }

  async setDeduction(caseId: string, dto: DeductionDto, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    const ledger = await this.ledger(serviceCase.id);
    const before = { deduction: ledger.deduction, reason: ledger.deductionReason };
    ledger.deduction = dto.amount.toFixed(2);
    ledger.deductionReason = dto.reason;
    ledger.deductBy = user.id;
    ledger.perfFinal = Math.max(0, Number(ledger.perfBase) - dto.amount).toFixed(2);
    ledger.deductionStatus = user.role === UserRole.SUPER_ADMIN ? 'approved' : 'pending';
    ledger.deductionReviewBy = user.role === UserRole.SUPER_ADMIN ? user.id : null;
    ledger.deductionReviewTime = user.role === UserRole.SUPER_ADMIN ? new Date() : null;
    await this.ledgers.save(ledger);
    await this.logs.write('case_performance', ledger.id, 'deduction', before, dto, user.id, '特殊扣减录入');
    return ledger;
  }

  async reviewDeduction(caseId: string, approved: boolean, comment: string | undefined, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('只有管理员可以复核特殊扣减');
    const ledger = await this.ledger(caseId);
    if (ledger.deductionStatus !== 'pending') throw new BadRequestException('该扣减不在待复核状态');
    ledger.deductionStatus = approved ? 'approved' : 'rejected';
    ledger.deductionReviewBy = user.id;
    ledger.deductionReviewTime = new Date();
    if (!approved) {
      ledger.deduction = '0.00';
      ledger.perfFinal = ledger.perfBase;
    }
    await this.ledgers.save(ledger);
    await this.logs.write('case_performance', ledger.id, 'deduction_status', 'pending', ledger.deductionStatus, user.id, comment || (approved ? '扣减复核通过' : '扣减复核驳回'));
    return ledger;
  }

  async myIncome(month: string | undefined, user: CurrentUserContext) {
    this.assertInspector(user);
    const selectedMonth = month || new Date().toISOString().slice(0, 7);
    const ledgers = await this.ledgers.find({
      where: { inspectorId: user.id, month: selectedMonth },
      order: { updatedAt: 'DESC' },
    });
    const cases = ledgers.length
      ? await this.cases.find({ where: { id: In(ledgers.map((item) => item.serviceCaseId)) } })
      : [];
    const caseMap = new Map(cases.map((item) => [item.id, item]));
    const caseIds = cases.map((item) => item.id);
    const orders = caseIds.length ? await this.orders.find({ where: { serviceCaseId: In(caseIds) } }) : [];
    const poIds = orders.map((item) => item.id);
    const items = poIds.length ? await this.items.find({ where: { poId: In(poIds) } }) : [];
    const orderMap = new Map<string, string>();
    orders.forEach((order) => orderMap.set(order.id, order.serviceCaseId!));
    const details = ledgers.map((ledger) => ({
      ...ledger,
      serviceCase: caseMap.get(ledger.serviceCaseId),
      items: items
        .filter((item) => orderMap.get(item.poId) === ledger.serviceCaseId)
        .map((item) => ({
          itemName: item.itemName,
          qty: item.qty,
          perfPrice: item.perfPrice,
          itemPerf: item.itemPerf,
        })),
    }));
    const approvedAmount = ledgers
      .filter((item) => item.reviewStatus === 'approved')
      .reduce((sum, item) => sum + Number(item.perfFinal), 0);
    const pendingAmount = ledgers
      .filter((item) => item.reviewStatus !== 'approved')
      .reduce((sum, item) => sum + Number(item.perfFinal), 0);
    const assessment = await this.assessments.findOne({ where: { month: selectedMonth, userId: user.id } });
    const settlement = await this.monthly.findOne({ where: { month: selectedMonth, userId: user.id } });
    return {
      month: selectedMonth,
      approvedAmount: approvedAmount.toFixed(2),
      pendingAmount: pendingAmount.toFixed(2),
      totalAmount: (approvedAmount + pendingAmount).toFixed(2),
      caseCount: ledgers.length,
      assessment: assessment
        ? {
            totalScore: assessment.totalScore,
            rankResult: assessment.rankResult,
            rewardAmount: assessment.rewardAmount,
            toolSubsidy: assessment.toolSubsidy,
            otherSubsidy: assessment.otherSubsidy,
            subsidyRemark: assessment.subsidyRemark,
          }
        : null,
      monthlySettlement: settlement
        ? { finalAmount: settlement.finalAmount, status: settlement.status }
        : null,
      list: details,
    };
  }

  private async caseForManager(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.cases.findOne({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('案例不存在');
    this.scope.assertCaseAccess(user, serviceCase);
    return serviceCase;
  }

  private async caseForInspector(caseId: string, user: CurrentUserContext) {
    this.assertInspector(user);
    const serviceCase = await this.cases.findOne({ where: { id: caseId } });
    if (!serviceCase || serviceCase.inspectorId !== user.id) throw new NotFoundException('案例不存在或未派给当前账号');
    return serviceCase;
  }

  private assertInspector(user: CurrentUserContext) {
    if (user.role !== UserRole.INSPECTOR) throw new ForbiddenException('仅工程师可执行此操作');
  }

  /**
   * 核算台账始终以当前 PO 条目为计算来源。
   * 新案例完工时可能尚无台账；价格调整后审核时也必须刷新快照。
   */
  private async refreshLedger(serviceCase: ServiceCase, resetReview = false) {
    const orders = await this.orders.find({ where: { serviceCaseId: serviceCase.id } });
    const poIds = orders.map((item) => item.id);
    const items = poIds.length
      ? await this.items.find({ where: { poId: In(poIds) } })
      : [];
    const billableItems = items.filter((item) => item.priceStatus !== 'ignored');
    const caseRevenue = billableItems.reduce(
      (sum, item) => sum + Number(item.itemRevenue || 0),
      0,
    );
    const perfBase = billableItems.reduce(
      (sum, item) => sum + Number(item.itemPerf || 0),
      0,
    );

    let ledger = await this.ledgers.findOne({ where: { serviceCaseId: serviceCase.id } });
    ledger ||= this.ledgers.create({
      serviceCaseId: serviceCase.id,
      gspCaseNo: serviceCase.gspCaseNo,
      deduction: '0.00',
      deductionStatus: 'none',
      reviewStatus: 'pending',
    });
    ledger.inspectorId = serviceCase.inspectorId;
    ledger.caseRevenue = caseRevenue.toFixed(2);
    ledger.perfBase = perfBase.toFixed(2);
    ledger.perfFinal = Math.max(0, perfBase - Number(ledger.deduction || 0)).toFixed(2);
    ledger.month = (serviceCase.finishTime || new Date()).toISOString().slice(0, 7);
    if (resetReview) {
      ledger.reviewStatus = 'pending';
      ledger.reviewerId = null;
      ledger.reviewTime = null;
      ledger.reviewComment = null;
    }
    return this.ledgers.save(ledger);
  }

  private async ledger(caseId: string) {
    const ledger = await this.ledgers.findOne({ where: { serviceCaseId: caseId } });
    if (!ledger) throw new NotFoundException('案例核算台账不存在');
    return ledger;
  }
}
