import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CasePerformance,
  CaseWorkRecord,
  CaseAssignment,
  CaseWorkUnit,
  CasePerfShare,
  CaseExpenseClaim,
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
  AssessmentEvent,
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
import { resolveTemplateEntries } from './demand-type-match';
import { FinanceScopeService } from './finance-scope.service';
import { TaskService } from '../../task/task.service';
import { FinanceMultiService } from './finance-multi.service';

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
    @InjectRepository(AssessmentEvent) private readonly assessmentEvents: Repository<AssessmentEvent>,
    @InjectRepository(MonthlySettlement) private readonly monthly: Repository<MonthlySettlement>,
    @InjectRepository(SiteMember) private readonly members: Repository<SiteMember>,
    @InjectRepository(InspectionTemplate)
    private readonly templates: Repository<InspectionTemplate>,
    @InjectRepository(InspectionTask) private readonly tasks: Repository<InspectionTask>,
    @InjectRepository(InspectionRecord) private readonly records: Repository<InspectionRecord>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(CaseAssignment) private readonly assignments: Repository<CaseAssignment>,
    @InjectRepository(CaseWorkUnit) private readonly units: Repository<CaseWorkUnit>,
    @InjectRepository(CasePerfShare) private readonly shares: Repository<CasePerfShare>,
    @InjectRepository(CaseExpenseClaim) private readonly expenses: Repository<CaseExpenseClaim>,
    private readonly taskService: TaskService,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
    @Inject(forwardRef(() => FinanceMultiService))
    private readonly multi: FinanceMultiService,
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
    // 当前案例已派工程师（改派弹窗要能显示姓名，即使对方已不在本网格编制）
    const activeAssign = await this.assignments.find({
      where: {
        serviceCaseId: caseId,
        status: In(['assigned', 'working', 'done']),
      },
    });
    const assigneeIds = new Set(activeAssign.map((a) => a.inspectorId));
    if (serviceCase.inspectorId) assigneeIds.add(serviceCase.inspectorId);

    // 派单列表：本网格已入职工程师 + 本案已派人员
    return inspectors
      .filter((item) => userHasRole(item, UserRole.INSPECTOR))
      .filter(
        (item) =>
          assigneeIds.has(item.id) || !siteMemberIds || siteMemberIds.has(item.id),
      )
      .map((item) => ({
        id: item.id,
        realName: item.realName,
        username: item.username,
        phone: item.phone,
        region: item.region,
        available: true,
        activeCaseCount: activeCountByInspector.get(item.id) || 0,
      }));
  }

  async assign(caseId: string, inspectorId: string, reason: string | undefined, user: CurrentUserContext) {
    return this.multi.assignInspectors(caseId, { inspectorId, reason }, user);
  }

  async assignMany(
    caseId: string,
    dto: { inspectorId?: string; inspectorIds?: string[]; reason?: string },
    user: CurrentUserContext,
  ) {
    return this.multi.assignInspectors(caseId, dto, user);
  }

  /** 巡检报告已提交后禁止改派网格/工程师（任一关联任务已提交即禁止） */
  async assertInspectionTransferable(caseId: string) {
    const submitted = await this.tasks.count({
      where: {
        serviceCaseId: caseId,
        status: In([TaskStatus.SUBMITTED, TaskStatus.APPROVED]),
      },
    });
    if (submitted > 0) {
      throw new BadRequestException('巡检报告已提交，不能再改派');
    }
  }

  /**
   * 改派网格时：完整清空原派单（assignment / 单元认领 / 未提交任务），供新网格重新派单。
   * 已有完成台或已提交单元时禁止，避免作业进度悬空。
   */
  async resetDispatchForSiteTransfer(serviceCase: ServiceCase) {
    await this.assertInspectionTransferable(serviceCase.id);

    const progressed = await this.units.count({
      where: {
        serviceCaseId: serviceCase.id,
        status: In(['submitted', 'completed', 'accepted', 'settled']),
      },
    });
    if (progressed > 0) {
      throw new BadRequestException(
        '已有提交或完成的作业台，不能改派网格；请完成结算后再调整归属，或联系管理员处理',
      );
    }

    // 撤回全部在派工程师
    await this.assignments
      .createQueryBuilder()
      .update(CaseAssignment)
      .set({ status: 'withdrawn' })
      .where('service_case_id = :caseId', { caseId: serviceCase.id })
      .andWhere('status IN (:...st)', { st: ['assigned', 'working', 'done'] })
      .execute();

    // 释放已认领未提交的单元
    const claimed = await this.units.find({
      where: {
        serviceCaseId: serviceCase.id,
        status: In(['claimed']),
      },
    });
    for (const u of claimed) {
      if (u.inspectionTaskId) {
        await this.records.delete({ taskId: u.inspectionTaskId });
        await this.tasks.delete({ id: u.inspectionTaskId });
      }
      u.status = 'open';
      u.inspectorId = null;
      u.claimedAt = null;
      u.submittedAt = null;
      u.inspectionTaskId = null;
      await this.units.save(u);
    }

    // 删除案例下剩余未提交巡检任务
    const leftoverTasks = await this.tasks.find({ where: { serviceCaseId: serviceCase.id } });
    for (const task of leftoverTasks) {
      await this.records.delete({ taskId: task.id });
      await this.tasks.delete(task.id);
    }

    await this.work.delete({ serviceCaseId: serviceCase.id });
    await this.ledgers.update({ serviceCaseId: serviceCase.id }, { inspectorId: null });

    serviceCase.inspectorId = null;
    serviceCase.assignBy = null;
    serviceCase.assignTime = null;
    serviceCase.completedUnits = 0;
    serviceCase.status = 'pending_assign';
  }

  async myCases(user: CurrentUserContext) {
    this.assertInspector(user);
    const assigned = await this.assignments.find({
      where: {
        inspectorId: user.id,
        status: In(['assigned', 'working', 'done']),
      },
    });
    const caseIds = [
      ...new Set([
        ...assigned.map((a) => a.serviceCaseId),
        // 兼容尚未回填 assignment 的旧数据
      ]),
    ];
    const legacy = await this.cases.find({
      where: { inspectorId: user.id },
      order: { updatedAt: 'DESC' },
    });
    for (const c of legacy) {
      if (!caseIds.includes(c.id)) caseIds.push(c.id);
    }
    const list = caseIds.length
      ? await this.cases.find({ where: { id: In(caseIds) }, order: { updatedAt: 'DESC' } })
      : [];
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

  async myCase(
    caseId: string,
    user: CurrentUserContext,
    opts?: { focusUnitId?: string },
  ) {
    const serviceCase = await this.caseForInspector(caseId, user);
    const [workRecord, orders, template, myUnits, extras] = await Promise.all([
      this.work.findOne({ where: { serviceCaseId: caseId } }),
      this.orders.find({ where: { serviceCaseId: caseId }, order: { demandDate: 'DESC' } }),
      serviceCase.taskTemplateId
        ? this.templates.findOne({ where: { id: serviceCase.taskTemplateId } })
        : Promise.resolve(null),
      this.units.find({
        where: { serviceCaseId: caseId },
        order: { seq: 'ASC' },
      }),
      this.multi.detailExtras(caseId),
    ]);
    // 同一工程师可同时认领多台；activeUnit 为当前聚焦台（认领后默认新认领的）
    const myActiveUnits = myUnits.filter(
      (u) =>
        u.inspectorId === user.id && ['claimed', 'submitted'].includes(u.status),
    );
    const focused =
      (opts?.focusUnitId &&
        myActiveUnits.find((u) => u.id === opts.focusUnitId)) ||
      null;
    const activeUnit = focused || myActiveUnits[0] || null;
    const inspectionTask = activeUnit?.inspectionTaskId
      ? await this.tasks.findOne({ where: { id: activeUnit.inspectionTaskId } })
      : await this.tasks.findOne({ where: { serviceCaseId: caseId, inspectorId: user.id } });
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
      activeUnit,
      myActiveUnits,
      ...extras,
      units: myUnits,
      expenses: (extras.expenses || []).filter(
        (e: { inspectorId?: string }) => e.inspectorId === user.id,
      ),
    };
  }

  async start(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForInspector(caseId, user);
    if (!['assigned', 'working'].includes(serviceCase.status)) {
      throw new BadRequestException('当前案例不能开始作业');
    }
    if (!serviceCase.taskTemplateId && !serviceCase.taskType) {
      throw new BadRequestException('案例未设置服务类型，无法开始巡检');
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
    await this.assignments.update(
      { serviceCaseId: caseId, inspectorId: user.id, status: 'assigned' },
      { status: 'working' },
    );

    await this.multi.ensureWorkUnits(serviceCase);

    // 多人：若已有进行中单元则进该任务；否则需先认领
    const active = await this.units.findOne({
      where: {
        serviceCaseId: caseId,
        inspectorId: user.id,
        status: In(['claimed', 'submitted']),
      },
    });
    if (active?.inspectionTaskId) {
      const task = await this.tasks.findOne({ where: { id: active.inspectionTaskId } });
      if (
        task &&
        (task.status === TaskStatus.PENDING || task.status === TaskStatus.REJECTED)
      ) {
        await this.taskService.start(task.id, user);
      }
      if (fromStatus !== serviceCase.status) {
        await this.logs.write(
          'service_case',
          caseId,
          'status',
          fromStatus,
          serviceCase.status,
          user.id,
          '工程师开始作业',
        );
      }
      return this.myCase(caseId, user);
    }

    if ((serviceCase.assignMode || 'single') === 'single') {
      const unit =
        (await this.units.findOne({
          where: { serviceCaseId: caseId },
          order: { seq: 'ASC' },
        })) || null;
      let task: InspectionTask;
      if (unit) {
        if (unit.status === 'open') {
          const claimed = await this.multi.claimUnit(caseId, unit.id, user);
          return claimed.case;
        }
        task = await this.ensureInspectionTaskForUnit(serviceCase, unit, user.id, user.id);
      } else {
        task = await this.ensureInspectionTask(serviceCase, user.id, user.id);
      }
      if (task.status === TaskStatus.PENDING || task.status === TaskStatus.REJECTED) {
        await this.taskService.start(task.id, user);
      }
    }

    if (fromStatus !== serviceCase.status) {
      await this.logs.write(
        'service_case',
        caseId,
        'status',
        fromStatus,
        serviceCase.status,
        user.id,
        '工程师开始作业',
      );
    }
    return this.myCase(caseId, user);
  }

  /**
   * 为费用案例创建/复用带 AI 的规范巡检任务（模板快照来自服务类型）。
   * 使用案例号生成占位设备，不依赖现场台账录入。
   */
  async ensureInspectionTask(
    serviceCase: ServiceCase,
    inspectorId: string,
    createdBy: string,
  ): Promise<InspectionTask> {
    const unit = await this.units.findOne({
      where: { serviceCaseId: serviceCase.id },
      order: { seq: 'ASC' },
    });
    if (unit) {
      return this.ensureInspectionTaskForUnit(serviceCase, unit, inspectorId, createdBy);
    }
    return this.createInspectionTask(serviceCase, inspectorId, createdBy, null);
  }

  async ensureInspectionTaskForUnit(
    serviceCase: ServiceCase,
    unit: CaseWorkUnit,
    inspectorId: string,
    createdBy: string,
  ): Promise<InspectionTask> {
    if (unit.inspectionTaskId) {
      const existing = await this.tasks.findOne({ where: { id: unit.inspectionTaskId } });
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
    }
    const byUnit = await this.tasks.findOne({ where: { workUnitId: unit.id } });
    if (byUnit) {
      unit.inspectionTaskId = byUnit.id;
      await this.units.save(unit);
      return byUnit;
    }
    const task = await this.createInspectionTask(serviceCase, inspectorId, createdBy, unit.id);
    unit.inspectionTaskId = task.id;
    if (unit.status === 'open') {
      unit.status = 'claimed';
      unit.inspectorId = inspectorId;
      unit.claimedAt = unit.claimedAt || new Date();
    }
    await this.units.save(unit);
    return task;
  }

  private async createInspectionTask(
    serviceCase: ServiceCase,
    inspectorId: string,
    createdBy: string,
    workUnitId: string | null,
  ): Promise<InspectionTask> {
    if (!serviceCase.siteId) {
      throw new BadRequestException('案例未分配网格，无法创建巡检任务');
    }
    if (!serviceCase.taskTemplateId) {
      throw new BadRequestException('案例未设置服务类型，无法创建巡检任务');
    }

    const template = await this.templates.findOne({
      where: { id: serviceCase.taskTemplateId },
    });
    if (!template) {
      throw new BadRequestException('服务类型模板不存在');
    }
    const snapshotEntries = resolveTemplateEntries(template, serviceCase.productLine);
    if (!snapshotEntries.length) {
      const lines = Array.isArray(template.productLines) ? template.productLines : [];
      if (lines.length && !serviceCase.productLine) {
        throw new BadRequestException('请先为案例选择产品线，再创建巡检任务');
      }
      if (lines.length) {
        throw new BadRequestException(
          `产品线「${serviceCase.productLine}」在服务类型「${template.name}」下无检查条目或不匹配`,
        );
      }
      throw new BadRequestException('服务类型模板不存在或没有检查条目');
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

    const unitSuffix = workUnitId ? `-U${workUnitId}` : '';
    return this.tasks.save(
      this.tasks.create({
        siteId: serviceCase.siteId,
        deviceId: device.id,
        taskName: `${serviceCase.gspCaseNo}${unitSuffix}-${serviceCase.projectName || '巡检'}`.slice(
          0,
          120,
        ),
        inspectorId,
        createdBy,
        serviceCaseId: serviceCase.id,
        workUnitId,
        taskType: WorkTaskType.INSPECTION,
        status: TaskStatus.PENDING,
        plannedDate: null,
        aiEnabled: true,
        templateSnapshot: snapshotEntries,
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
    const mode = serviceCase.assignMode || 'single';

    // 多人：完工 = 完成「可完成」的那一台（可同时认领多台，不能误完成未提交的）
    if (mode === 'multi') {
      const mine = await this.units.find({
        where: {
          serviceCaseId: caseId,
          inspectorId: user.id,
          status: In(['claimed', 'submitted']),
        },
        order: { seq: 'ASC' },
      });
      if (!mine.length) {
        throw new BadRequestException('没有进行中的执行单元，请先认领后再提交');
      }
      // 优先已 submitted；否则找巡检任务已提交/通过的 claimed
      let target = mine.find((u) => u.status === 'submitted') || null;
      if (!target) {
        for (const u of mine) {
          if (!u.inspectionTaskId) continue;
          const task = await this.tasks.findOne({ where: { id: u.inspectionTaskId } });
          if (
            task &&
            [TaskStatus.SUBMITTED, TaskStatus.APPROVED].includes(task.status as TaskStatus)
          ) {
            target = u;
            break;
          }
        }
      }
      if (!target) {
        throw new BadRequestException(
          '请先提交某一台的巡检报告后再完成本台；其他未完成的台可继续保留',
        );
      }
      if (target.inspectionTaskId) {
        await this.multi.markUnitSubmittedByTask(target.inspectionTaskId, user.id);
      }
      return this.multi.completeUnit(caseId, target.id, user);
    }

    if (serviceCase.status !== 'working') throw new BadRequestException('请先开始作业再完工');
    const record = await this.work.findOne({ where: { serviceCaseId: caseId } });
    if (!record) throw new BadRequestException('请先完成巡检与工作记录');
    const inspectionTask =
      (await this.tasks.findOne({
        where: { serviceCaseId: caseId, inspectorId: user.id },
      })) || (await this.tasks.findOne({ where: { serviceCaseId: caseId } }));
    if (inspectionTask) {
      if (
        ![TaskStatus.SUBMITTED, TaskStatus.APPROVED].includes(
          inspectionTask.status as TaskStatus,
        )
      ) {
        throw new BadRequestException('请先完成并提交巡检报告后再确认完工');
      }
      if (inspectionTask.workUnitId) {
        await this.multi.markUnitSubmittedByTask(inspectionTask.id, user.id);
        const unit = await this.units.findOne({ where: { id: inspectionTask.workUnitId } });
        if (unit && unit.status !== 'completed') {
          return this.multi.completeUnit(caseId, unit.id, user);
        }
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
    return this.finishCaseInternal(serviceCase, user);
  }

  /** 整案结案（全部单元完成或单人模式） */
  async finishCaseInternal(serviceCase: ServiceCase, user: CurrentUserContext) {
    const caseId = serviceCase.id;
    if (['finished', 'settle_review', 'settled', 'month_locked'].includes(serviceCase.status)) {
      return serviceCase;
    }
    const hasPo = (await this.orders.count({ where: { serviceCaseId: caseId } })) > 0;
    const from = serviceCase.status;
    serviceCase.status = hasPo ? 'settle_review' : 'finished';
    serviceCase.finishTime = new Date();
    serviceCase.completedUnits = Math.max(
      serviceCase.completedUnits || 0,
      serviceCase.plannedUnits || 1,
    );
    await this.cases.save(serviceCase);

    const record = await this.work.findOne({ where: { serviceCaseId: caseId } });
    if (record) {
      record.completedAt = new Date();
      await this.work.save(record);
    }
    await this.assignments.update(
      { serviceCaseId: caseId, status: In(['assigned', 'working']) },
      { status: 'done' },
    );

    if (hasPo) {
      const ledger = await this.refreshLedger(serviceCase, true);
      await this.multi.refreshShares(serviceCase, Number(ledger.perfFinal || 0));
    } else {
      await this.multi.refreshShares(serviceCase, 0);
    }
    await this.logs.write(
      'service_case',
      caseId,
      'status',
      from,
      serviceCase.status,
      user.id,
      '案例完工确认',
    );
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

  /**
   * 结算审核金额来源：PO 条目（结算价/绩效价）+ 本案例事件扣罚。
   * 网格长也可看绩效价，便于核对「计件绩效」合计。
   */
  async amountBreakdown(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    const ledger = await this.ledgers.findOne({ where: { serviceCaseId: caseId } });
    const orders = await this.orders.find({
      where: { serviceCaseId: caseId },
      order: { demandDate: 'DESC' },
    });
    const poIds = orders.map((o) => o.id);
    const rawItems = poIds.length
      ? await this.items.find({
          where: { poId: In(poIds) },
          order: { sourceRow: 'ASC', id: 'ASC' },
        })
      : [];
    const items = rawItems
      .filter((item) => item.priceStatus !== 'ignored')
      .map((item) => ({
        id: item.id,
        poId: item.poId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        unit: item.unit,
        qty: item.qty,
        settlePrice: item.settlePrice,
        itemRevenue: item.itemRevenue,
        perfPrice: item.perfPrice,
        itemPerf: item.itemPerf,
        priceStatus: item.priceStatus,
      }));
    const events = await this.assessmentEvents.find({
      where: { serviceCaseId: caseId },
      order: { createdAt: 'DESC' },
    });
    const userIds = [...new Set(events.map((e) => e.userId).filter(Boolean))];
    const people = userIds.length
      ? await this.users.find({ where: { id: In(userIds) } })
      : [];
    const nameMap = new Map(people.map((p) => [p.id, p.realName || p.username]));
    const eventPenalty = events.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const caseRevenue =
      Number(ledger?.caseRevenue ?? 0) ||
      items.reduce((sum, i) => sum + Number(i.itemRevenue || 0), 0);
    const perfBase =
      Number(ledger?.perfBase ?? 0) ||
      items.reduce((sum, i) => sum + Number(i.itemPerf || 0), 0);

    return {
      caseId: serviceCase.id,
      gspCaseNo: serviceCase.gspCaseNo,
      projectName: serviceCase.projectName,
      finishTime: serviceCase.finishTime,
      caseRevenue: caseRevenue.toFixed(2),
      perfBase: perfBase.toFixed(2),
      deduction: Number(ledger?.deduction || 0).toFixed(2),
      perfFinal: Number(ledger?.perfFinal || Math.max(0, perfBase - Number(ledger?.deduction || 0))).toFixed(2),
      eventPenalty: eventPenalty.toFixed(2),
      items,
      events: events.map((e) => ({
        id: e.id,
        category: e.category,
        content: e.content,
        amount: e.amount,
        remark: e.remark,
        userId: e.userId,
        userName: nameMap.get(e.userId) || null,
        createdAt: e.createdAt,
      })),
    };
  }

  async pendingReview(
    user: CurrentUserContext,
    query: {
      keyword?: string;
      siteId?: string;
      month?: string;
      overdue?: string;
      reviewStatus?: string;
    } = {},
  ) {
    const statusFilter = (query.reviewStatus || 'pending').trim();
    const qb = this.cases
      .createQueryBuilder('c')
      .innerJoin(CasePerformance, 'p', 'p.service_case_id=c.id')
      .leftJoin(User, 'u', 'u.id=c.inspector_id')
      .select([
        'c.id AS id',
        'c.gsp_case_no AS "gspCaseNo"',
        'c.project_name AS "projectName"',
        'c.region AS region',
        'c.site_id AS "siteId"',
        'c.inspector_id AS "inspectorId"',
        'c.finish_time AS "finishTime"',
        'c.status AS status',
        `COALESCE(
          (
            SELECT string_agg(u2.real_name, '、' ORDER BY ca.assign_time NULLS LAST, ca.id)
            FROM case_assignment ca
            INNER JOIN users u2 ON u2.id = ca.inspector_id
            WHERE ca.service_case_id = c.id
              AND ca.status IN ('assigned','working','done')
          ),
          u.real_name
        ) AS "inspectorName"`,
        'p.perf_base AS "perfBase"',
        'p.deduction AS deduction',
        'p.perf_final AS "perfFinal"',
        'p.case_revenue AS "caseRevenue"',
        'p.review_status AS "reviewStatus"',
        'p.deduction_status AS "deductionStatus"',
        'p.review_time AS "reviewTime"',
        'p.review_comment AS "reviewComment"',
        `(SELECT COALESCE(SUM(ae.amount), 0) FROM assessment_event ae
          WHERE ae.service_case_id = c.id) AS "eventPenalty"`,
        `(SELECT COUNT(*) FROM po_item pi
          INNER JOIN po_order po ON po.id=pi.po_id
          WHERE po.service_case_id=c.id
            AND pi.price_status <> 'ignored'
            AND pi.perf_price IS NULL) AS "missingPerf"`,
      ])
      .where("c.status IN ('settle_review','settled')");
    if (statusFilter === 'approved') {
      qb.andWhere("p.review_status = 'approved'");
    } else if (statusFilter === 'rejected') {
      qb.andWhere("p.review_status = 'rejected'");
    } else if (statusFilter === 'all') {
      qb.andWhere("p.review_status IN ('pending','rejected','approved')");
    } else {
      // 默认待审核队列：含驳回后待重审
      qb.andWhere("p.review_status IN ('pending','rejected')");
    }
    if (user.role === UserRole.SITE_MANAGER) {
      if (!user.managedSiteIds?.length) return [];
      qb.andWhere('c.site_id IN (:...siteIds)', { siteIds: user.managedSiteIds });
    } else if (query.siteId) {
      qb.andWhere('c.site_id = :filterSiteId', { filterSiteId: query.siteId });
    }
    if (query.keyword?.trim()) {
      qb.andWhere(
        `(c.gsp_case_no ILIKE :kw OR c.project_name ILIKE :kw OR u.real_name ILIKE :kw
          OR EXISTS (
            SELECT 1 FROM case_assignment ca
            INNER JOIN users u3 ON u3.id = ca.inspector_id
            WHERE ca.service_case_id = c.id
              AND ca.status IN ('assigned','working','done')
              AND u3.real_name ILIKE :kw
          ))`,
        { kw: `%${query.keyword.trim()}%` },
      );
    }
    if (query.month) {
      qb.andWhere(`to_char(c.finish_time AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = :finishMonth`, {
        finishMonth: query.month,
      });
    }
    if (statusFilter === 'approved' || statusFilter === 'all') {
      qb.orderBy('p.review_time', 'DESC', 'NULLS LAST').addOrderBy('c.finish_time', 'DESC');
    } else {
      qb.orderBy('c.finish_time', 'ASC');
    }
    const rows = await qb.getRawMany();
    const overdueOnly = query.overdue === 'true' || query.overdue === '1';
    return rows
      .map((row) => {
        const dueAt = row.finishTime
          ? new Date(new Date(row.finishTime).getTime() + 7 * 86400000)
          : null;
        const overdue = !!dueAt && dueAt.getTime() < Date.now();
        return {
          ...row,
          missingPerf: Number(row.missingPerf || 0),
          eventPenalty: Number(row.eventPenalty || 0),
          approvalReady: !!row.inspectorName && Number(row.missingPerf || 0) === 0,
          dueAt,
          overdue,
          remainingHours: dueAt ? Math.ceil((dueAt.getTime() - Date.now()) / 3600000) : null,
        };
      })
      .filter((row) => (overdueOnly ? row.overdue : true));
  }

  async approve(caseId: string, comment: string | undefined, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    if (serviceCase.status !== 'settle_review') throw new BadRequestException('当前案例不在待结算审核状态');
    const assigneeCount = await this.assignments.count({
      where: {
        serviceCaseId: caseId,
        status: In(['assigned', 'working', 'done']),
      },
    });
    if (!serviceCase.inspectorId && !assigneeCount) {
      throw new BadRequestException('案例尚未关联工程师，不能审核结算');
    }
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
    await this.multi.refreshShares(serviceCase, Number(ledger.perfFinal || 0));
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

    // 1) 优先按分账取本人绩效（多人案例）
    const shareRows = await this.shares
      .createQueryBuilder('s')
      .innerJoin(CasePerformance, 'p', 'p.service_case_id = s.service_case_id')
      .where('s.inspector_id = :uid', { uid: user.id })
      .andWhere('p.month = :month', { month: selectedMonth })
      .getMany();
    const shareByCase = new Map(shareRows.map((s) => [s.serviceCaseId, s]));

    // 2) 兼容无分账的旧单人台账（ledger.inspectorId = 本人）
    const primaryLedgers = await this.ledgers.find({
      where: { inspectorId: user.id, month: selectedMonth },
      order: { updatedAt: 'DESC' },
    });

    const caseIdSet = new Set<string>([
      ...shareRows.map((s) => s.serviceCaseId),
      ...primaryLedgers.map((l) => l.serviceCaseId),
    ]);
    const caseIds = [...caseIdSet];
    const ledgers = caseIds.length
      ? await this.ledgers.find({
          where: { serviceCaseId: In(caseIds), month: selectedMonth },
          order: { updatedAt: 'DESC' },
        })
      : [];
    const ledgerByCase = new Map(ledgers.map((l) => [l.serviceCaseId, l]));

    const cases = caseIds.length
      ? await this.cases.find({ where: { id: In(caseIds) } })
      : [];
    const caseMap = new Map(cases.map((item) => [item.id, item]));
    const orders = caseIds.length ? await this.orders.find({ where: { serviceCaseId: In(caseIds) } }) : [];
    const poIds = orders.map((item) => item.id);
    const items = poIds.length ? await this.items.find({ where: { poId: In(poIds) } }) : [];
    const orderMap = new Map<string, string>();
    orders.forEach((order) => orderMap.set(order.id, order.serviceCaseId!));

    const events = await this.assessmentEvents.find({
      where: { month: selectedMonth, userId: user.id },
      order: { createdAt: 'DESC' },
    });
    const eventsByCase = new Map<string, AssessmentEvent[]>();
    const otherEvents: AssessmentEvent[] = [];
    events.forEach((event) => {
      if (event.serviceCaseId) {
        const list = eventsByCase.get(event.serviceCaseId) || [];
        list.push(event);
        eventsByCase.set(event.serviceCaseId, list);
      } else {
        otherEvents.push(event);
      }
    });
    const mapEvent = (event: AssessmentEvent) => ({
      id: event.id,
      category: event.category,
      content: event.content,
      qty: event.qty,
      unit: event.unit,
      amount: event.amount,
      remark: event.remark,
    });

    const details = caseIds
      .map((caseId) => {
        const ledger = ledgerByCase.get(caseId);
        if (!ledger) return null;
        const serviceCase = caseMap.get(caseId);
        const share = shareByCase.get(caseId);
        const casePerfFinal = Number(ledger.perfFinal || 0);
        const myPerf = share
          ? Number(share.perfAmount || 0)
          : ledger.inspectorId === user.id
            ? casePerfFinal
            : 0;
        const shareRatio = share
          ? Number(share.shareRatio || 0)
          : casePerfFinal > 0 && myPerf === casePerfFinal
            ? 1
            : casePerfFinal > 0
              ? myPerf / casePerfFinal
              : 1;
        const caseEvents = eventsByCase.get(caseId) || [];
        const eventPenaltyTotal = caseEvents.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const multi =
          Number(serviceCase?.plannedUnits || 1) > 1 ||
          (share != null && Number(share.shareRatio || 0) < 0.999999);
        return {
          ...ledger,
          /** 本人实得绩效（多人按分账；单人等于全案） */
          perfFinal: myPerf.toFixed(2),
          casePerfFinal: casePerfFinal.toFixed(2),
          myShareRatio: shareRatio.toFixed(6),
          myCompletedUnits: share?.completedUnits ?? null,
          plannedUnits: serviceCase?.plannedUnits ?? null,
          assignMode: serviceCase?.assignMode || (multi ? 'multi' : 'single'),
          isShared: !!share && Number(share.shareRatio || 0) < 0.999999,
          serviceCase,
          items: items
            .filter((item) => orderMap.get(item.poId) === caseId)
            .map((item) => {
              const full = Number(item.itemPerf || 0);
              return {
                itemName: item.itemName,
                qty: item.qty,
                perfPrice: item.perfPrice,
                itemPerf: (full * shareRatio).toFixed(2),
                caseItemPerf: full.toFixed(2),
              };
            }),
          eventPenalties: caseEvents.map(mapEvent),
          eventPenaltyTotal: eventPenaltyTotal.toFixed(2),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const ta = new Date(a!.updatedAt || 0).getTime();
        const tb = new Date(b!.updatedAt || 0).getTime();
        return tb - ta;
      });

    const approvedAmount = details
      .filter((item) => item!.reviewStatus === 'approved')
      .reduce((sum, item) => sum + Number(item!.perfFinal), 0);
    const pendingAmount = details
      .filter((item) => item!.reviewStatus !== 'approved')
      .reduce((sum, item) => sum + Number(item!.perfFinal), 0);

    const approvedExpenses = await this.expenses.find({
      where: { inspectorId: user.id, month: selectedMonth, status: 'approved' },
      order: { createdAt: 'DESC' },
    });
    const expenseCaseIds = [...new Set(approvedExpenses.map((e) => e.serviceCaseId).filter(Boolean))];
    const expenseCases = expenseCaseIds.length
      ? await this.cases.find({
          where: { id: In(expenseCaseIds) },
          select: ['id', 'projectName', 'gspCaseNo'],
        })
      : [];
    const expenseCaseMap = new Map(expenseCases.map((c) => [c.id, c]));
    const expenseTotal = approvedExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const assessment = await this.assessments.findOne({
      where: { month: selectedMonth, userId: user.id },
    });
    const settlement = await this.monthly.findOne({
      where: { month: selectedMonth, userId: user.id },
    });
    const eventPenaltyTotal = events.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      month: selectedMonth,
      approvedAmount: approvedAmount.toFixed(2),
      pendingAmount: pendingAmount.toFixed(2),
      totalAmount: (approvedAmount + pendingAmount).toFixed(2),
      caseCount: details.length,
      assessment: assessment
        ? {
            totalScore: assessment.totalScore,
            rankResult: assessment.rankResult,
            rewardAmount: assessment.rewardAmount,
            eventPenalty: assessment.eventPenalty || eventPenaltyTotal.toFixed(2),
            toolSubsidy: assessment.toolSubsidy,
            otherSubsidy: assessment.otherSubsidy,
            subsidyRemark: assessment.subsidyRemark,
            correctionAmount: assessment.correctionAmount,
            correctionReason: assessment.correctionReason,
          }
        : null,
      monthlySettlement: settlement
        ? {
            perfTotal: settlement.perfTotal,
            expenseTotal: settlement.expenseTotal,
            rewardTotal: settlement.rewardTotal,
            eventPenalty: settlement.eventPenalty,
            subsidyTotal: settlement.subsidyTotal,
            correctionTotal: settlement.correctionTotal,
            finalAmount: settlement.finalAmount,
            status: settlement.status,
          }
        : {
            perfTotal: approvedAmount.toFixed(2),
            expenseTotal: expenseTotal.toFixed(2),
            rewardTotal: '0.00',
            eventPenalty: eventPenaltyTotal.toFixed(2),
            subsidyTotal: '0.00',
            correctionTotal: '0.00',
            finalAmount: (approvedAmount + expenseTotal - eventPenaltyTotal).toFixed(2),
            status: 'draft',
          },
      expenses: approvedExpenses.map((e) => {
        const linked = expenseCaseMap.get(e.serviceCaseId);
        return {
          id: e.id,
          serviceCaseId: e.serviceCaseId,
          amount: e.amount,
          note: e.note,
          month: e.month,
          projectName: linked?.projectName || null,
          gspCaseNo: linked?.gspCaseNo || null,
        };
      }),
      otherEventPenalties: otherEvents.map(mapEvent),
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
    if (!serviceCase) throw new NotFoundException('案例不存在或未派给当前账号');
    if (serviceCase.inspectorId === user.id) return serviceCase;
    const assignment = await this.assignments.findOne({
      where: {
        serviceCaseId: caseId,
        inspectorId: user.id,
        status: In(['assigned', 'working', 'done']),
      },
    });
    if (!assignment) throw new NotFoundException('案例不存在或未派给当前账号');
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
