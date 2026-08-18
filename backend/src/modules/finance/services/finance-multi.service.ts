import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CaseAssignment,
  CaseExpenseClaim,
  CasePerfShare,
  CasePerformance,
  CaseWorkUnit,
  InspectionTask,
  InspectionTemplate,
  ServiceCase,
  User,
} from '../../../entities';
import { CommonStatus, TaskStatus, UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { monthKeyShanghai } from '../../../common/utils/month-key';
import { userHasRole } from '../../../common/utils/user-roles';
import { VisionService } from '../../ai/vision.service';
import { ChangeLogService } from './change-log.service';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceWorkflowService } from './finance-workflow.service';
import { FinanceSettlementService } from './finance-settlement.service';
import type { ExpenseLineItem, ExpenseNavShot } from '../../../entities/case-expense-claim.entity';

type TripExpenseInput = {
  lineItems?: Array<Partial<ExpenseLineItem> & { type?: string; content?: string }>;
  startOdometerUrl?: string;
  startNavUrl?: string;
  startNavUrls?: string[];
  startMileage?: number;
  endOdometerUrl?: string;
  endNavUrl?: string;
  endNavUrls?: string[];
  endMileage?: number;
  amount?: number;
  voucherUrls?: string[];
  note?: string;
  submit?: boolean;
  /** true=开工选择无行程；false=改为需要行程 */
  tripSkipped?: boolean;
  /** @deprecated */
  tollAmount?: number;
  fuelAmount?: number;
  otherAmount?: number;
  tollVoucherUrls?: string[];
  fuelVoucherUrls?: string[];
  otherVoucherUrls?: string[];
};

@Injectable()
export class FinanceMultiService implements OnModuleInit {
  private readonly logger = new Logger(FinanceMultiService.name);
  private serialColsReady = false;

  constructor(
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(CaseAssignment) private readonly assignments: Repository<CaseAssignment>,
    @InjectRepository(CaseWorkUnit) private readonly units: Repository<CaseWorkUnit>,
    @InjectRepository(CasePerfShare) private readonly shares: Repository<CasePerfShare>,
    @InjectRepository(CaseExpenseClaim) private readonly expenses: Repository<CaseExpenseClaim>,
    @InjectRepository(CasePerformance) private readonly ledgers: Repository<CasePerformance>,
    @InjectRepository(InspectionTask) private readonly tasks: Repository<InspectionTask>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly logs: ChangeLogService,
    private readonly scope: FinanceScopeService,
    private readonly vision: VisionService,
    @Inject(forwardRef(() => FinanceWorkflowService))
    private readonly workflow: FinanceWorkflowService,
    @Inject(forwardRef(() => FinanceSettlementService))
    private readonly settlement: FinanceSettlementService,
  ) {}

  async onModuleInit() {
    await this.ensureDeviceSerialColumns();
    await this.ensureExpenseLineItemsColumn();
    await this.ensureAssignRemarkColumn();
  }

  /** 兼容未跑迁移：派单备注 */
  private async ensureAssignRemarkColumn() {
    try {
      await this.cases.manager.query(`
        ALTER TABLE service_case
          ADD COLUMN IF NOT EXISTS assign_remark text NULL
      `);
    } catch (err) {
      this.logger.warn(
        `ensureAssignRemarkColumn skipped: ${(err as Error).message || err}`,
      );
    }
  }

  /** 兼容未跑迁移的环境：补齐费用明细列 */
  private async ensureExpenseLineItemsColumn() {
    try {
      await this.expenses.manager.query(`
        ALTER TABLE case_expense_claim
          ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb
      `);
    } catch (err) {
      this.logger.warn(
        `ensureExpenseLineItemsColumn skipped: ${(err as Error).message || err}`,
      );
    }
  }

  /** 兼容未跑迁移的环境：补齐序列号相关列 */
  private async ensureDeviceSerialColumns() {
    if (this.serialColsReady) return;
    try {
      await this.units.manager.query(`
        ALTER TABLE case_work_unit
          ADD COLUMN IF NOT EXISTS device_serial varchar(128),
          ADD COLUMN IF NOT EXISTS serial_photo_url text,
          ADD COLUMN IF NOT EXISTS serial_confirmed_at timestamptz
      `);
      this.serialColsReady = true;
    } catch (err) {
      this.logger.warn(
        `ensureDeviceSerialColumns skipped: ${(err as Error).message || err}`,
      );
    }
  }

  /** 同步案例执行单元：按 plannedUnits 创建缺失、清理超出计划且仍可认领的单元 */
  async ensureWorkUnits(serviceCase: ServiceCase) {
    await this.ensureDeviceSerialColumns();
    const planned = Math.max(1, Number(serviceCase.plannedUnits) || 1);
    const existing = await this.units.find({
      where: { serviceCaseId: serviceCase.id },
      order: { seq: 'ASC' },
    });
    const label = '台';

    // 标签变更后，把自动生成的旧标题（如「网格 #1」）同步成当前标签
    const toRename = existing.filter((u) => {
      const expected = `${label} #${u.seq}`;
      if (!u.title) return true;
      if (u.title === expected) return false;
      return /^(.+?)\s*#\d+$/.test(u.title);
    });
    if (toRename.length) {
      for (const u of toRename) {
        u.title = `${label} #${u.seq}`;
      }
      await this.units.save(toRename);
    }

    // 计划缩减后：删除超出计划、仍为 open 的孤儿单元（有进展的保留，避免丢历史）
    const excessOpen = existing.filter((u) => u.seq > planned && u.status === 'open');
    if (excessOpen.length) {
      await this.units.remove(excessOpen);
    }

    const remaining = await this.units.find({
      where: { serviceCaseId: serviceCase.id },
      order: { seq: 'ASC' },
    });
    const have = new Set(remaining.map((u) => u.seq));
    const toCreate: CaseWorkUnit[] = [];
    for (let seq = 1; seq <= planned; seq += 1) {
      if (have.has(seq)) continue;
      toCreate.push(
        this.units.create({
          serviceCaseId: serviceCase.id,
          seq,
          title: `${label} #${seq}`,
          status: 'open',
          submitCount: 0,
        }),
      );
    }
    if (toCreate.length) await this.units.save(toCreate);

    return this.units.find({
      where: { serviceCaseId: serviceCase.id },
      order: { seq: 'ASC' },
    });
  }

  /**
   * 调整作业计划（管理员 / 网格长）
   * - 作业中：可增可减（减时只能去掉末尾仍可认领的单元，且不少于已完成数）
   * - 已完工 / 待结算审核：只允许增补台数，并自动重开为「作业中」
   * - 已结算 / 已月结：禁止
   */
  async setWorkPlan(
    caseId: string,
    dto: { plannedUnits?: number; expenseEnabled?: boolean },
    user: CurrentUserContext,
  ) {
    const serviceCase = await this.caseForManager(caseId, user);
    if (['settled', 'month_locked'].includes(serviceCase.status)) {
      throw new BadRequestException('已结算或已月结的案例不能再改作业计划');
    }

    const fromStatus = serviceCase.status;
    const fromPlanned = serviceCase.plannedUnits;
    const closedStatuses = ['finished', 'settle_review'];
    const isClosed = closedStatuses.includes(serviceCase.status);

    if (dto.plannedUnits !== undefined) {
      const n = Math.floor(Number(dto.plannedUnits));
      if (!Number.isFinite(n) || n < 1 || n > 500) {
        throw new BadRequestException('计划单元数须在 1～500');
      }
      const completed = await this.units.count({
        where: { serviceCaseId: caseId, status: 'completed' },
      });

      if (isClosed) {
        if (n <= (serviceCase.plannedUnits || 0)) {
          throw new BadRequestException(
            '案例已完工，只能增补台数（新计划须大于当前计划）。若要减少请在作业中调整。',
          );
        }
        if (n < completed) {
          throw new BadRequestException(`计划单元不能少于已完成数（${completed}）`);
        }

        serviceCase.plannedUnits = n;
        serviceCase.completedUnits = completed;
        serviceCase.status = 'working';
        serviceCase.finishTime = null;
        await this.cases.save(serviceCase);

        await this.assignments.update(
          { serviceCaseId: caseId, status: 'done' },
          { status: 'working' },
        );
        await this.cases.manager.query(
          `UPDATE case_work_record SET completed_at = NULL WHERE service_case_id = $1`,
          [caseId],
        );
        await this.ensureWorkUnits(serviceCase);

        await this.logs.write(
          'service_case',
          caseId,
          'work_plan_supplement',
          { status: fromStatus, plannedUnits: fromPlanned },
          { status: 'working', plannedUnits: n },
          user.id,
          `完工后增补台数 ${fromPlanned} → ${n}，案例重开作业`,
        );
      } else {
        if (n < completed) {
          throw new BadRequestException(`计划单元不能少于已完成数（${completed}）`);
        }
        if (n < (serviceCase.plannedUnits || 0)) {
          const all = await this.units.find({
            where: { serviceCaseId: caseId },
            order: { seq: 'DESC' },
          });
          for (const u of all) {
            if (u.seq <= n) break;
            if (u.status !== 'open') {
              throw new BadRequestException(
                `单元 #${u.seq} 已有进展（${u.status}），不能缩减计划数；请先处理后再减`,
              );
            }
            await this.units.delete(u.id);
          }
        }
        serviceCase.plannedUnits = n;
        serviceCase.completedUnits = completed;
        await this.cases.save(serviceCase);
        await this.ensureWorkUnits(serviceCase);

        if (n !== fromPlanned) {
          await this.logs.write(
            'service_case',
            caseId,
            'work_plan',
            { plannedUnits: fromPlanned },
            { plannedUnits: n },
            user.id,
            `调整计划台数 ${fromPlanned} → ${n}`,
          );
        }
      }
    }

    if (dto.expenseEnabled !== undefined) {
      serviceCase.expenseEnabled = !!dto.expenseEnabled;
      await this.cases.save(serviceCase);
    }

    return this.detailExtras(caseId);
  }

  /**
   * 派单：支持多人。单人模式仅允许 1 人；多人可追加。
   * 兼容旧字段 inspectorId。
   */
  async assignInspectors(
    caseId: string,
    dto: {
      inspectorId?: string;
      inspectorIds?: string[];
      assignMode?: 'single' | 'multi';
      plannedUnits?: number;
      reason?: string;
    },
    user: CurrentUserContext,
  ) {
    const ids = [
      ...new Set(
        [...(dto.inspectorIds || []), ...(dto.inspectorId ? [dto.inspectorId] : [])].filter(
          Boolean,
        ),
      ),
    ] as string[];
    if (!ids.length) throw new BadRequestException('请选择至少一名工程师');

    const serviceCase = await this.caseForManager(caseId, user);
    if (!serviceCase.siteId) {
      throw new BadRequestException('请先将案例分配到网格，再派给本网格工程师');
    }
    if (!serviceCase.taskTemplateId && !serviceCase.taskType) {
      throw new BadRequestException('请先设置案例服务类型');
    }
    if (serviceCase.taskTemplateId) {
      const tpl = await this.cases.manager
        .getRepository(InspectionTemplate)
        .findOne({ where: { id: serviceCase.taskTemplateId } });
      const lines = Array.isArray(tpl?.productLines) ? tpl!.productLines : [];
      if (lines.length && !String(serviceCase.productLine || '').trim()) {
        throw new BadRequestException('该服务类型已配置产品线，请先在「设类型」中选择产品线');
      }
    }
    if (['finished', 'settle_review', 'settled', 'month_locked'].includes(serviceCase.status)) {
      throw new BadRequestException('案例已完工或进入结算，不能再派单');
    }

    // 派单时选择单人/多人（不再从服务类型模板同步）；报销由工程师按需填写
    const nextMode: 'single' | 'multi' =
      dto.assignMode === 'multi' || dto.assignMode === 'single'
        ? dto.assignMode
        : serviceCase.assignMode === 'multi'
          ? 'multi'
          : 'single';
    if (nextMode !== serviceCase.assignMode && serviceCase.status !== 'pending_assign') {
      // 仅「已提交/已完成」算实质进度。单人派单会自动认领台位(claimed)，完成 0 台时也应允许改多人。
      const hasRealProgress = await this.units.count({
        where: {
          serviceCaseId: caseId,
          status: In(['submitted', 'completed', 'accepted', 'settled']),
        },
      });
      const activeAssignRows = await this.assignments.find({
        where: {
          serviceCaseId: caseId,
          status: In(['assigned', 'working', 'done']),
        },
      });
      const hasDoneUnits = activeAssignRows.some((a) => Number(a.completedUnits || 0) > 0);
      if (hasRealProgress > 0 || hasDoneUnits) {
        throw new BadRequestException('已有提交或完成的作业台，不能切换单人/多人模式');
      }
      // 切模式前释放仅认领未提交的台，避免单人自动认领卡住多人抢台
      await this.releaseUnsubmittedClaims(caseId);
    }
    serviceCase.assignMode = nextMode;
    serviceCase.unitLabel = '台';
    serviceCase.expenseEnabled = true;
    if (dto.reason !== undefined) {
      const remark = String(dto.reason || '').trim();
      serviceCase.assignRemark = remark || null;
    }
    const fromPlanned = serviceCase.plannedUnits;
    if (dto.plannedUnits != null) {
      serviceCase.plannedUnits = Math.max(1, Math.min(500, Number(dto.plannedUnits) || 1));
    } else if (nextMode === 'single') {
      // 单人也可多台：未传台数时保留原计划，至少 1
      serviceCase.plannedUnits = Math.max(1, Number(serviceCase.plannedUnits) || 1);
    } else if (!serviceCase.plannedUnits || serviceCase.plannedUnits < 1) {
      serviceCase.plannedUnits = Math.max(ids.length, 1);
    }

    // 缩减计划时：超出部分若已有作业进展则禁止；否则由 ensureWorkUnits 清理 open 孤儿
    if (serviceCase.plannedUnits < (fromPlanned || 0)) {
      const blocked = await this.units.find({
        where: { serviceCaseId: caseId },
        order: { seq: 'DESC' },
      });
      for (const u of blocked) {
        if (u.seq <= serviceCase.plannedUnits) break;
        if (u.status !== 'open') {
          throw new BadRequestException(
            `单元 #${u.seq} 已有进展（${u.status}），不能把计划缩到 ${serviceCase.plannedUnits}；请先用「调整作业计划」或处理后再改`,
          );
        }
      }
    }

    await this.cases.save(serviceCase);

    const mode = serviceCase.assignMode || 'single';
    if (mode === 'single' && ids.length > 1) {
      throw new BadRequestException('单人模式只能派给一名工程师');
    }

    const existing = await this.assignments.find({ where: { serviceCaseId: caseId } });
    const activeExisting = existing.filter((a) => a.status !== 'withdrawn');

    // 多人模式至少 2 人（含已在派 + 本次追加）
    if (mode === 'multi') {
      const projected = new Set([
        ...activeExisting.map((a) => a.inspectorId).filter(Boolean),
        ...ids,
      ]);
      if (projected.size < 2) {
        throw new BadRequestException(
          '多人模式至少需要 2 名工程师；只需 1 人请使用单人模式',
        );
      }
    }

    // 单人改派 / 多人改单人：只保留目标工程师，其余无进度则可撤回
    if (mode === 'single') {
      const target = ids[0];
      const toWithdraw = activeExisting.filter((a) => a.inspectorId !== target);
      const keepingExisting = activeExisting.some((a) => a.inspectorId === target);
      if (toWithdraw.length > 0 || !keepingExisting) {
        await this.workflow.assertInspectionTransferable(caseId);
      }
      for (const a of toWithdraw) {
        if (Number(a.completedUnits || 0) > 0) {
          throw new BadRequestException('已有完成单元，不能改派');
        }
        a.status = 'withdrawn';
        await this.assignments.save(a);
      }
      // 释放被撤回工程师的认领台，并删除未提交巡检任务（避免新人挂上旧任务 → 无权访问）
      const claimed = await this.units.find({
        where: { serviceCaseId: caseId, status: In(['claimed', 'submitted']) },
      });
      for (const u of claimed) {
        if (keepingExisting && u.inspectorId === target) continue;
        if (u.inspectionTaskId) {
          await this.cases.manager.query(`DELETE FROM inspection_records WHERE task_id = $1`, [
            u.inspectionTaskId,
          ]);
          await this.tasks.delete({ id: u.inspectionTaskId });
        }
        this.releaseUnitToOpen(u);
        await this.units.save(u);
      }
      // 再清掉被撤回工程师名下、未挂台或残留的未提交任务
      for (const a of toWithdraw) {
        if (!a.inspectorId) continue;
        const pendingTasks = await this.tasks.find({
          where: {
            serviceCaseId: caseId,
            inspectorId: a.inspectorId,
            status: In([TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED]),
          },
        });
        for (const t of pendingTasks) {
          await this.cases.manager.query(`DELETE FROM inspection_records WHERE task_id = $1`, [
            t.id,
          ]);
          await this.tasks.delete(t.id);
        }
      }
    }

    for (const inspectorId of ids) {
      await this.assertHiredInspector(serviceCase.siteId!, inspectorId);
      let row = existing.find((a) => a.inspectorId === inspectorId);
      if (row && row.status === 'withdrawn') {
        row.status = 'assigned';
        row.assignBy = user.id;
        row.assignTime = new Date();
        await this.assignments.save(row);
      } else if (!row) {
        row = await this.assignments.save(
          this.assignments.create({
            serviceCaseId: caseId,
            inspectorId,
            assignBy: user.id,
            assignTime: new Date(),
            status: 'assigned',
            completedUnits: 0,
          }),
        );
      }
    }

    await this.ensureWorkUnits(serviceCase);

    // 兼容主工程师字段：取第一个在派人员
    const actives = await this.assignments.find({
      where: { serviceCaseId: caseId, status: In(['assigned', 'working', 'done']) },
      order: { assignTime: 'ASC' },
    });
    const primary = actives[0];
    if (primary) {
      serviceCase.inspectorId = primary.inspectorId;
      serviceCase.assignBy = user.id;
      serviceCase.assignTime = new Date();
      // 首次派单 → 已派单；换人且尚无实质进度 → 回到已派单（新人未开工）
      if (serviceCase.status === 'pending_assign') {
        serviceCase.status = 'assigned';
      } else if (
        mode === 'single' &&
        serviceCase.status === 'working' &&
        ids.length === 1
      ) {
        const hasRealProgress = await this.units.count({
          where: {
            serviceCaseId: caseId,
            status: In(['submitted', 'completed', 'accepted', 'settled']),
          },
        });
        const hasDoneUnits = actives.some((a) => Number(a.completedUnits || 0) > 0);
        if (!hasRealProgress && !hasDoneUnits) {
          serviceCase.status = 'assigned';
          // 在派记录也回到 assigned，表示待开工
          for (const a of actives) {
            if (a.status === 'working') {
              a.status = 'assigned';
              await this.assignments.save(a);
            }
          }
        }
      }
      await this.cases.save(serviceCase);

      // 单人：直接认领唯一单元并建任务
      if (mode === 'single') {
        const units = await this.units.find({
          where: { serviceCaseId: caseId },
          order: { seq: 'ASC' },
        });
        const unit = units[0];
        if (unit && unit.status === 'open') {
          await this.claimUnitInternal(serviceCase, unit, primary.inspectorId, user.id);
        }
      }
    }

    await this.logs.write(
      'service_case',
      caseId,
      'assignment',
      { inspectorIds: activeExisting.map((a) => a.inspectorId) },
      { inspectorIds: ids },
      user.id,
      dto.reason?.trim() || `派单 → ${ids.length} 人`,
    );
    return this.detailExtras(caseId);
  }

  async claimUnit(caseId: string, unitId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForAssignee(caseId, user);
    if (!['assigned', 'working'].includes(serviceCase.status)) {
      throw new BadRequestException('当前案例状态不可认领');
    }
    const unit = await this.units.findOne({ where: { id: unitId, serviceCaseId: caseId } });
    if (!unit) throw new NotFoundException('执行单元不存在');
    if (unit.status !== 'open') throw new BadRequestException('该单元已被认领或已完成');
    const planned = Math.max(1, Number(serviceCase.plannedUnits) || 1);
    if (unit.seq > planned) {
      throw new BadRequestException(
        `单元 #${unit.seq} 已超出当前计划台数（${planned}），请刷新后重试`,
      );
    }

    // 乐观锁：仅 open 可抢
    const result = await this.units
      .createQueryBuilder()
      .update(CaseWorkUnit)
      .set({
        status: 'claimed',
        inspectorId: user.id,
        claimedAt: new Date(),
      })
      .where('id = :id AND status = :status', { id: unitId, status: 'open' })
      .execute();
    if (!result.affected) throw new BadRequestException('认领失败，请刷新后重试');

    const fresh = await this.units.findOne({ where: { id: unitId } });
    if (!fresh) throw new NotFoundException('执行单元不存在');

    if (serviceCase.status === 'assigned') {
      serviceCase.status = 'working';
      await this.cases.save(serviceCase);
    }
    await this.assignments.update(
      { serviceCaseId: caseId, inspectorId: user.id, status: 'assigned' },
      { status: 'working' },
    );

    const task = await this.workflow.ensureInspectionTaskForUnit(
      serviceCase,
      fresh,
      user.id,
      user.id,
    );
    fresh.inspectionTaskId = task.id;
    await this.units.save(fresh);

    return {
      unit: fresh,
      inspectionTaskId: task.id,
      case: await this.workflow.myCase(caseId, user, { focusUnitId: fresh.id }),
    };
  }

  /** 巡检报告提交后：单元 → submitted（多人）；单人仍走 finish 兼容 */
  async markUnitSubmittedByTask(taskId: string, userId: string) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task?.workUnitId) return null;
    const unit = await this.units.findOne({ where: { id: task.workUnitId } });
    if (!unit || unit.inspectorId !== userId) return null;
    if (!['claimed', 'submitted'].includes(unit.status)) return null;
    unit.status = 'submitted';
    unit.submittedAt = new Date();
    unit.submitCount = (unit.submitCount || 0) + 1;
    await this.units.save(unit);
    return unit;
  }

  async completeUnit(caseId: string, unitId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForAssignee(caseId, user);
    const unit = await this.units.findOne({ where: { id: unitId, serviceCaseId: caseId } });
    if (!unit) throw new NotFoundException('执行单元不存在');
    if (unit.inspectorId !== user.id) throw new BadRequestException('只能完成自己认领的单元');
    if (unit.status === 'completed') return this.afterUnitProgress(serviceCase, user);
    // 行程已改为案例详情可选填写，完成本台不再强绑结束里程

    if (unit.status === 'claimed') {
      // 允许：任务已提交则一并完成
      const task = unit.inspectionTaskId
        ? await this.tasks.findOne({ where: { id: unit.inspectionTaskId } })
        : null;
      if (
        !task ||
        ![TaskStatus.SUBMITTED, TaskStatus.APPROVED].includes(task.status as TaskStatus)
      ) {
        throw new BadRequestException('请先提交本单元巡检报告');
      }
      unit.status = 'submitted';
      unit.submittedAt = unit.submittedAt || new Date();
      unit.submitCount = Math.max(1, unit.submitCount || 0);
    }
    if (unit.status !== 'submitted') {
      throw new BadRequestException('当前单元状态不可完成');
    }

    unit.status = 'completed';
    unit.completedAt = new Date();
    await this.units.save(unit);

    const assignment = await this.assignments.findOne({
      where: { serviceCaseId: caseId, inspectorId: user.id },
    });
    if (assignment) {
      assignment.completedUnits = (assignment.completedUnits || 0) + 1;
      await this.assignments.save(assignment);
    }

    const completed = await this.units.count({
      where: { serviceCaseId: caseId, status: 'completed' },
    });
    serviceCase.completedUnits = completed;
    await this.cases.save(serviceCase);

    // 全部完成 → 结案
    if (completed >= (serviceCase.plannedUnits || 1)) {
      await this.workflow.finishCaseInternal(serviceCase, user);
    }

    return this.afterUnitProgress(serviceCase, user);
  }

  async listUnits(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForManagerOrAssignee(caseId, user);
    if (['assigned', 'working'].includes(serviceCase.status)) {
      await this.ensureWorkUnits(serviceCase);
    }
    const planned = Math.max(1, Number(serviceCase.plannedUnits) || 1);
    const units = await this.units.find({
      where: { serviceCaseId: caseId },
      order: { seq: 'ASC' },
    });
    // 展示以计划台数为准；超出计划的 open 已清理，有进展的历史行仍返回供核对
    return units.filter((u) => u.seq <= planned || u.status !== 'open');
  }

  async detailExtras(caseId: string) {
    const serviceCase = await this.cases.findOne({ where: { id: caseId } });
    if (serviceCase && ['assigned', 'working'].includes(serviceCase.status)) {
      await this.ensureWorkUnits(serviceCase);
    }
    const planned = Math.max(1, Number(serviceCase?.plannedUnits) || 1);
    const [assignments, rawUnits, shares, expenses] = await Promise.all([
      this.assignments.find({
        where: { serviceCaseId: caseId, status: In(['assigned', 'working', 'done']) },
        order: { assignTime: 'ASC' },
      }),
      this.units.find({ where: { serviceCaseId: caseId }, order: { seq: 'ASC' } }),
      this.shares.find({ where: { serviceCaseId: caseId } }),
      this.expenses.find({ where: { serviceCaseId: caseId }, order: { createdAt: 'DESC' } }),
    ]);
    const units = rawUnits.filter((u) => u.seq <= planned || u.status !== 'open');
    const userIds = [
      ...new Set([
        ...assignments.map((a) => a.inspectorId),
        ...shares.map((s) => s.inspectorId),
        ...expenses.map((e) => e.inspectorId),
      ]),
    ];
    const people = userIds.length
      ? await this.users.find({ where: { id: In(userIds) } })
      : [];
    const nameMap = new Map(people.map((u) => [u.id, u.realName]));
    return {
      assignments: assignments.map((a) => ({
        ...a,
        inspectorName: nameMap.get(a.inspectorId) || a.inspectorId,
      })),
      units,
      shares: shares.map((s) => ({
        ...s,
        inspectorName: nameMap.get(s.inspectorId) || s.inspectorId,
      })),
      expenses: expenses.map((e) => {
        const unit = units.find((u) => u.id === e.workUnitId);
        const startNavUrls = this.normalizeNavUrls(e.startNavUrls, e.startNavUrl);
        const endNavUrls = this.normalizeNavUrls(e.endNavUrls, e.endNavUrl);
        const lineItems = Array.isArray(e.lineItems) ? e.lineItems : [];
        return {
          ...e,
          lineItems,
          startNavUrls,
          endNavUrls,
          startNavUrl: startNavUrls[0] || e.startNavUrl || null,
          endNavUrl: endNavUrls[0] || e.endNavUrl || null,
          unitSeq: unit?.seq ?? null,
          unitTitle: unit?.title ?? null,
          inspectorName: nameMap.get(e.inspectorId) || e.inspectorId,
        };
      }),
      expenseSummary: {
        totalAmount: expenses
          .reduce((s, e) => s + Number(e.amount || 0), 0)
          .toFixed(2),
        approvedAmount: expenses
          .filter((e) => e.status === 'approved')
          .reduce((s, e) => s + Number(e.amount || 0), 0)
          .toFixed(2),
        submittedAmount: expenses
          .filter((e) => e.status === 'submitted')
          .reduce((s, e) => s + Number(e.amount || 0), 0)
          .toFixed(2),
        count: expenses.length,
      },
    };
  }

  /** 按完成单元重算分账（结算审核通过或结案时调用） */
  async refreshShares(serviceCase: ServiceCase, perfFinal: number) {
    const planned = Math.max(1, Number(serviceCase.plannedUnits) || 1);
    const completedUnits = await this.units.find({
      where: { serviceCaseId: serviceCase.id, status: 'completed' },
    });
    const byInspector = new Map<string, number>();
    for (const u of completedUnits) {
      if (!u.inspectorId) continue;
      byInspector.set(u.inspectorId, (byInspector.get(u.inspectorId) || 0) + 1);
    }
    // 单人未走单元完成时，回退到主工程师全额
    if (!byInspector.size && serviceCase.inspectorId) {
      byInspector.set(serviceCase.inspectorId, planned);
    }

    await this.shares.delete({ serviceCaseId: serviceCase.id });
    const entries = [...byInspector.entries()];
    if (!entries.length) return [];

    let allocated = 0;
    const rows: CasePerfShare[] = [];
    entries.forEach(([inspectorId, count], index) => {
      const ratio = count / planned;
      let amount =
        index === entries.length - 1
          ? Number((perfFinal - allocated).toFixed(2))
          : Number((perfFinal * ratio).toFixed(2));
      if (index < entries.length - 1) allocated += amount;
      rows.push(
        this.shares.create({
          serviceCaseId: serviceCase.id,
          inspectorId,
          completedUnits: count,
          shareRatio: ratio.toFixed(6),
          perfAmount: amount.toFixed(2),
        }),
      );
    });
    // 尾差修正：最后一人
    if (rows.length) {
      const sumExceptLast = rows.slice(0, -1).reduce((s, r) => s + Number(r.perfAmount), 0);
      rows[rows.length - 1].perfAmount = (perfFinal - sumExceptLast).toFixed(2);
    }
    return this.shares.save(rows);
  }

  // —— 行程报销（案例 × 工程师一条，可选） ——
  async upsertExpense(
    caseId: string,
    dto: TripExpenseInput & { workUnitId?: string },
    user: CurrentUserContext,
  ) {
    return this.upsertMyTripExpense(caseId, dto, user);
  }

  /** 兼容旧路径 /units/:unitId/expense：仍落到本人本案例一条 */
  async upsertTripExpense(
    caseId: string,
    _unitId: string,
    dto: TripExpenseInput,
    user: CurrentUserContext,
  ) {
    return this.upsertMyTripExpense(caseId, dto, user);
  }

  async upsertMyTripExpense(
    caseId: string,
    dto: TripExpenseInput & { workUnitId?: string },
    user: CurrentUserContext,
  ) {
    const serviceCase = await this.caseForAssignee(caseId, user);
    if (!serviceCase.expenseEnabled) {
      serviceCase.expenseEnabled = true;
      await this.cases.save(serviceCase);
    }

    let claim = await this.expenses.findOne({
      where: { serviceCaseId: caseId, inspectorId: user.id },
    });
    if (claim?.status === 'submitted') {
      throw new BadRequestException('已提交的报销请等待审核，驳回后才能修改');
    }
    if (claim?.status === 'approved') {
      throw new BadRequestException('已通过的报销不可修改');
    }

    // 兼容旧数据：可选挂一个本人台，仅作展示，不再作为唯一键
    let linkUnitId: string | null = claim?.workUnitId || null;
    if (dto.workUnitId) {
      try {
        const unit = await this.resolveExpenseUnit(caseId, user, dto.workUnitId);
        linkUnitId = unit.id;
      } catch {
        /* ignore */
      }
    } else if (!linkUnitId) {
      try {
        const unit = await this.resolveExpenseUnit(caseId, user, undefined);
        linkUnitId = unit.id;
      } catch {
        linkUnitId = null;
      }
    }

    claim ||= this.expenses.create({
      serviceCaseId: caseId,
      workUnitId: linkUnitId,
      inspectorId: user.id,
      amount: '0.00',
      claimAmount: '0.00',
      tollAmount: '0.00',
      fuelAmount: '0.00',
      otherAmount: '0.00',
      voucherUrls: [],
      tollVoucherUrls: [],
      fuelVoucherUrls: [],
      otherVoucherUrls: [],
      startNavUrls: [],
      endNavUrls: [],
      lineItems: [],
      tripSkipped: false,
      status: 'draft',
    });
    if (linkUnitId) claim.workUnitId = linkUnitId;

    if (dto.lineItems !== undefined) {
      const normalized = this.normalizeLineItems(dto.lineItems);
      this.applyLineItemsToClaim(claim, normalized);
      if (dto.submit) {
        this.assertLineItemsReady(normalized);
        claim.amount = Number(claim.claimAmount || claim.amount || 0).toFixed(2);
        claim.status = 'submitted';
        claim.reviewNote = null;
        claim.reviewBy = null;
        claim.reviewAt = null;
      } else if (claim.status === 'rejected') {
        claim.status = 'draft';
      }
      return this.expenses.save(claim);
    }

    if (dto.tripSkipped === true) {
      claim.tripSkipped = true;
      // 明确无行程：清空开始资料，避免半填状态
      claim.startOdometerUrl = null;
      claim.startNavUrl = null;
      claim.startNavUrls = [];
      claim.startMileage = null;
      claim.endOdometerUrl = null;
      claim.endNavUrl = null;
      claim.endNavUrls = [];
      claim.endMileage = null;
      claim.mileageKm = null;
    } else if (dto.tripSkipped === false) {
      claim.tripSkipped = false;
    }

    // 空值不覆盖已有开始资料，避免结束行程保存时把开始里程/导航图误清空
    if (dto.startOdometerUrl) claim.startOdometerUrl = dto.startOdometerUrl;
    this.applyNavUrls(claim, 'start', dto.startNavUrls, dto.startNavUrl);
    if (dto.startMileage !== undefined && dto.startMileage != null && !Number.isNaN(Number(dto.startMileage))) {
      claim.startMileage = Number(dto.startMileage).toFixed(1);
    }
    // 一旦上传开始里程资料，视为选择「有行程」
    if (
      claim.startOdometerUrl ||
      this.navUrlList(claim, 'start').length ||
      claim.startMileage
    ) {
      claim.tripSkipped = false;
    }
    if (dto.endOdometerUrl) claim.endOdometerUrl = dto.endOdometerUrl;
    this.applyNavUrls(claim, 'end', dto.endNavUrls, dto.endNavUrl);
    if (dto.endMileage !== undefined && dto.endMileage != null && !Number.isNaN(Number(dto.endMileage))) {
      claim.endMileage = Number(dto.endMileage).toFixed(1);
    }
    if (dto.note !== undefined) claim.note = dto.note;

    // 单一申报金额 + 批量凭证（优先）；兼容旧分项累加
    if (dto.voucherUrls) {
      claim.voucherUrls = dto.voucherUrls.slice(0, 20);
    } else if (dto.tollVoucherUrls || dto.fuelVoucherUrls || dto.otherVoucherUrls) {
      claim.voucherUrls = [
        ...(dto.tollVoucherUrls || claim.tollVoucherUrls || []),
        ...(dto.fuelVoucherUrls || claim.fuelVoucherUrls || []),
        ...(dto.otherVoucherUrls || claim.otherVoucherUrls || []),
      ].slice(0, 20);
    }

    if (dto.amount !== undefined) {
      const n = Math.max(0, Number(dto.amount) || 0).toFixed(2);
      claim.claimAmount = n;
      claim.amount = n;
    } else if (
      dto.tollAmount !== undefined ||
      dto.fuelAmount !== undefined ||
      dto.otherAmount !== undefined
    ) {
      if (dto.tollAmount !== undefined) claim.tollAmount = Math.max(0, Number(dto.tollAmount) || 0).toFixed(2);
      if (dto.fuelAmount !== undefined) claim.fuelAmount = Math.max(0, Number(dto.fuelAmount) || 0).toFixed(2);
      if (dto.otherAmount !== undefined) claim.otherAmount = Math.max(0, Number(dto.otherAmount) || 0).toFixed(2);
      const sum = (
        Number(claim.tollAmount || 0) +
        Number(claim.fuelAmount || 0) +
        Number(claim.otherAmount || 0)
      ).toFixed(2);
      claim.claimAmount = sum;
      claim.amount = sum;
    }

    const startM = claim.startMileage != null ? Number(claim.startMileage) : null;
    const endM = claim.endMileage != null ? Number(claim.endMileage) : null;
    if (startM != null && endM != null && Number.isFinite(startM) && Number.isFinite(endM)) {
      if (endM < startM) {
        throw new BadRequestException('结束里程不能小于开始里程');
      }
      claim.mileageKm = (endM - startM).toFixed(1);
    } else {
      claim.mileageKm = null;
    }

    if (dto.submit) {
      const hasMoney = Number(claim.claimAmount || claim.amount) > 0;
      // 旧流程：有行程里程/导航即可；费用凭证不再强制
      if (
        !hasMoney &&
        !claim.startOdometerUrl &&
        !claim.endOdometerUrl
      ) {
        throw new BadRequestException('请先填写行程里程或报销金额');
      }
      claim.amount = Number(claim.claimAmount || claim.amount || 0).toFixed(2);
      claim.status = 'submitted';
      claim.reviewNote = null;
      claim.reviewBy = null;
      claim.reviewAt = null;
    } else if (claim.status === 'rejected') {
      claim.status = 'draft';
    }

    return this.expenses.save(claim);
  }

  /**
   * @deprecated 开工门禁已移出巡检；保留兼容。
   */
  async assertTripStartReady(caseId: string, _unitId: string, user: CurrentUserContext) {
    const claim = await this.expenses.findOne({
      where: { serviceCaseId: caseId, inspectorId: user.id },
    });
    if (claim?.tripSkipped) return claim;
    const hasStart =
      !!claim?.startOdometerUrl &&
      this.navUrlList(claim!, 'start').length > 0 &&
      claim!.startMileage != null &&
      claim!.startMileage !== '';
    if (hasStart) return claim!;
    throw new BadRequestException('请先选择无行程或填写开始里程后再开工');
  }

  /**
   * 软校验：有开始无结束时返回提示用信息；完成本台不再调用。
   */
  async assertTripEndReady(caseId: string, _unitId: string, user: CurrentUserContext) {
    const claim = await this.expenses.findOne({
      where: { serviceCaseId: caseId, inspectorId: user.id },
    });
    if (!claim || claim.tripSkipped) return claim;
    const hasStart =
      !!claim.startOdometerUrl &&
      this.navUrlList(claim, 'start').length > 0 &&
      claim.startMileage != null &&
      claim.startMileage !== '';
    if (!hasStart) return claim;
    if (!claim.endOdometerUrl || this.navUrlList(claim, 'end').length === 0) {
      throw new BadRequestException('已填写开始行程，请补填结束里程表和导航截图');
    }
    if (claim.endMileage == null || claim.endMileage === '') {
      throw new BadRequestException('请填写或识别结束里程后再完成本台');
    }
    return claim;
  }

  async ocrMyMileage(
    caseId: string,
    imageUrl: string,
    kind: 'start' | 'end' | undefined,
    user: CurrentUserContext,
  ) {
    await this.caseForAssignee(caseId, user);
    const result = await this.vision.readOdometerMileage(imageUrl);
    return { ...result, kind: kind || 'start' };
  }

  async ocrUnitMileage(
    caseId: string,
    _unitId: string,
    imageUrl: string,
    kind: 'start' | 'end' | undefined,
    user: CurrentUserContext,
  ) {
    return this.ocrMyMileage(caseId, imageUrl, kind, user);
  }

  async ocrUnitDeviceSerial(caseId: string, unitId: string, imageUrl: string, user: CurrentUserContext) {
    await this.resolveSerialUnit(caseId, unitId, user);
    return this.vision.readDeviceSerial(imageUrl);
  }

  async saveUnitDeviceSerial(
    caseId: string,
    unitId: string,
    dto: { deviceSerial: string; serialPhotoUrl?: string },
    user: CurrentUserContext,
  ) {
    const unit = await this.resolveSerialUnit(caseId, unitId, user);
    const serial = String(dto.deviceSerial || '')
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase();
    if (!serial || serial.length < 4) {
      throw new BadRequestException('请填写有效的设备序列号（至少 4 位）');
    }
    // 仅本案例内查重（不同案例允许相同序列号）
    const occupied = await this.units
      .createQueryBuilder('u')
      .where('u.service_case_id = :caseId', { caseId })
      .andWhere('u.id <> :unitId', { unitId: unit.id })
      .andWhere('u.device_serial IS NOT NULL')
      .andWhere(`UPPER(REPLACE(TRIM(u.device_serial), ' ', '')) = :serial`, { serial })
      .select(['u.seq AS seq'])
      .limit(1)
      .getRawOne<{ seq: number }>();
    if (occupied) {
      const seq =
        occupied.seq != null ? `台 #${occupied.seq}` : '其他作业台';
      throw new BadRequestException(
        `序列号 ${serial} 已在本案例用于${seq}，同一案例内不能重复`,
      );
    }
    unit.deviceSerial = serial.slice(0, 128);
    if (dto.serialPhotoUrl?.trim()) {
      unit.serialPhotoUrl = dto.serialPhotoUrl.trim();
    }
    unit.serialConfirmedAt = new Date();
    await this.units.save(unit);
    return {
      id: unit.id,
      seq: unit.seq,
      deviceSerial: unit.deviceSerial,
      serialPhotoUrl: unit.serialPhotoUrl,
      serialConfirmedAt: unit.serialConfirmedAt,
    };
  }

  private async resolveSerialUnit(caseId: string, unitId: string, user: CurrentUserContext) {
    await this.caseForAssignee(caseId, user);
    const unit = await this.units.findOne({ where: { id: unitId, serviceCaseId: caseId } });
    if (!unit) throw new NotFoundException('作业台不存在');
    if (unit.inspectorId !== user.id) {
      throw new BadRequestException('只能为自己认领的台确认序列号');
    }
    if (!['claimed', 'submitted', 'completed'].includes(unit.status)) {
      throw new BadRequestException('请先认领该台后再识别序列号');
    }
    return unit;
  }

  private async resolveExpenseUnit(
    caseId: string,
    user: CurrentUserContext,
    unitId?: string,
  ) {
    await this.caseForAssignee(caseId, user);
    if (unitId) {
      const unit = await this.units.findOne({ where: { id: unitId, serviceCaseId: caseId } });
      if (!unit) throw new NotFoundException('作业台不存在');
      if (unit.inspectorId && unit.inspectorId !== user.id) {
        throw new BadRequestException('只能为自己认领的台填写行程报销');
      }
      return unit;
    }
    const mine = await this.units.findOne({
      where: {
        serviceCaseId: caseId,
        inspectorId: user.id,
        status: In(['claimed', 'submitted', 'completed']),
      },
      order: { seq: 'ASC' },
    });
    if (mine) return mine;
    const first = await this.units.findOne({
      where: { serviceCaseId: caseId },
      order: { seq: 'ASC' },
    });
    if (!first) throw new BadRequestException('暂无作业台，请先接单或认领');
    return first;
  }

  async reviewExpense(
    expenseId: string,
    pass: boolean,
    note: string | undefined,
    user: CurrentUserContext,
    approvedAmount?: number,
  ) {
    const claim = await this.expenses.findOne({ where: { id: expenseId } });
    if (!claim) throw new NotFoundException('报销单不存在');
    const serviceCase = await this.caseForManager(claim.serviceCaseId, user);
    if (claim.status !== 'submitted') throw new BadRequestException('仅待审报销可审核');
    if (
      !['finished', 'settle_review', 'settled', 'month_locked'].includes(serviceCase.status)
    ) {
      throw new BadRequestException('案例完工后才可审核行程报销');
    }
    claim.status = pass ? 'approved' : 'rejected';
    claim.reviewBy = user.id;
    claim.reviewAt = new Date();
    claim.reviewNote = note?.trim() || null;
    if (pass) {
      // 保留申报额；结算用核定额（管理员可改，如报100核定80）
      if (!claim.claimAmount || Number(claim.claimAmount) === 0) {
        claim.claimAmount = claim.amount;
      }
      if (approvedAmount !== undefined && Number.isFinite(approvedAmount)) {
        if (approvedAmount < 0) throw new BadRequestException('核定金额无效');
        claim.amount = Number(approvedAmount).toFixed(2);
      } else {
        claim.amount = Number(claim.claimAmount || claim.amount || 0).toFixed(2);
      }
      claim.month = monthKeyShanghai(serviceCase.finishTime || new Date());
    } else {
      claim.month = null;
    }
    await this.expenses.save(claim);
    if (pass && claim.month) {
      await this.settlement.refreshMonthPublic(claim.month);
    }
    return claim;
  }

  async listExpenses(
    user: CurrentUserContext,
    query: { status?: string; keyword?: string; month?: string } = {},
  ) {
    const statusFilter = (query.status || 'pending').trim();
    const qb = this.expenses
      .createQueryBuilder('e')
      .innerJoin(ServiceCase, 'c', 'c.id = e.service_case_id')
      .leftJoin(CaseWorkUnit, 'u', 'u.id = e.work_unit_id');
    if (statusFilter === 'approved') {
      qb.andWhere("e.status = 'approved'");
    } else if (statusFilter === 'rejected') {
      qb.andWhere("e.status = 'rejected'");
    } else if (statusFilter === 'all') {
      // 含「无行程」草稿，便于管理员看见标记
      qb.andWhere(
        "(e.status IN ('submitted','approved','rejected') OR (e.status = 'draft' AND e.trip_skipped = true))",
      );
    } else {
      qb.andWhere("e.status = 'submitted'");
      // 案例完工后才进入管理员待审，与案例结算节奏对齐；作业中已提交的先排队
      qb.andWhere("c.status IN ('finished','settle_review','settled','month_locked')");
    }
    if (query.month?.trim()) {
      const finishKey = query.month.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(finishKey)) {
        qb.andWhere(
          `to_char(COALESCE(c.finish_time, e.created_at) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') = :finishDay`,
          { finishDay: finishKey },
        );
      } else if (/^\d{4}-\d{2}$/.test(finishKey)) {
        qb.andWhere(
          `(e.month = :month OR (e.month IS NULL AND to_char(COALESCE(c.finish_time, e.created_at) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = :month))`,
          { month: finishKey },
        );
      }
    }
    if (query.keyword?.trim()) {
      qb.andWhere(
        `(c.gsp_case_no ILIKE :kw OR c.project_name ILIKE :kw OR e.note ILIKE :kw)`,
        { kw: `%${query.keyword.trim()}%` },
      );
    }
    if (user.role === UserRole.SITE_MANAGER) {
      const siteIds = user.managedSiteIds || [];
      if (!siteIds.length) return [];
      qb.andWhere('c.site_id IN (:...siteIds)', { siteIds });
    } else if (user.role !== UserRole.SUPER_ADMIN) {
      return [];
    }
    if (statusFilter === 'pending') {
      qb.orderBy('e.created_at', 'ASC');
    } else {
      qb.orderBy('e.review_at', 'DESC', 'NULLS LAST').addOrderBy('e.created_at', 'DESC');
    }
    const raw = await qb
      .select([
        'e.id AS id',
        'e.service_case_id AS "serviceCaseId"',
        'e.work_unit_id AS "workUnitId"',
        'e.inspector_id AS "inspectorId"',
        'e.amount AS amount',
        'e.claim_amount AS "claimAmount"',
        'e.toll_amount AS "tollAmount"',
        'e.fuel_amount AS "fuelAmount"',
        'e.other_amount AS "otherAmount"',
        'e.note AS note',
        'e.line_items AS "lineItems"',
        'e.voucher_urls AS "voucherUrls"',
        'e.toll_voucher_urls AS "tollVoucherUrls"',
        'e.fuel_voucher_urls AS "fuelVoucherUrls"',
        'e.other_voucher_urls AS "otherVoucherUrls"',
        'e.start_odometer_url AS "startOdometerUrl"',
        'e.start_nav_url AS "startNavUrl"',
        'e.start_nav_urls AS "startNavUrls"',
        'e.start_mileage AS "startMileage"',
        'e.end_odometer_url AS "endOdometerUrl"',
        'e.end_nav_url AS "endNavUrl"',
        'e.end_nav_urls AS "endNavUrls"',
        'e.end_mileage AS "endMileage"',
        'e.mileage_km AS "mileageKm"',
        'e.trip_skipped AS "tripSkipped"',
        'e.status AS status',
        'e.month AS month',
        'e.review_note AS "reviewNote"',
        'e.review_at AS "reviewAt"',
        'e.created_at AS "createdAt"',
        'c.gsp_case_no AS "gspCaseNo"',
        'c.project_name AS "projectName"',
        'c.site_id AS "siteId"',
        'c.status AS "caseStatus"',
        'c.unit_label AS "unitLabel"',
        'u.seq AS "unitSeq"',
      ])
      .getRawMany();
    const userIds = [...new Set(raw.map((r) => r.inspectorId).filter(Boolean))];
    const people = userIds.length
      ? await this.users.find({ where: { id: In(userIds) } })
      : [];
    const nameMap = new Map(people.map((u) => [u.id, u.realName]));
    const caseIds = [...new Set(raw.map((r) => String(r.serviceCaseId)))];
    const caseTotals = new Map<string, number>();
    if (caseIds.length) {
      const sumRows = await this.expenses
        .createQueryBuilder('e')
        .select('e.service_case_id', 'serviceCaseId')
        .addSelect('COALESCE(SUM(e.amount::numeric),0)', 'total')
        .where('e.service_case_id IN (:...caseIds)', { caseIds })
        .andWhere("e.status IN ('submitted','approved')")
        .groupBy('e.service_case_id')
        .getRawMany();
      for (const s of sumRows) {
        caseTotals.set(String(s.serviceCaseId), Number(s.total || 0));
      }
    }
    /** 报销按人×案例，展示该工程师完成台数，避免误显示「台#1」 */
    const completedByKey = new Map<string, number>();
    if (caseIds.length && userIds.length) {
      const countRows = await this.units
        .createQueryBuilder('u')
        .select('u.service_case_id', 'serviceCaseId')
        .addSelect('u.inspector_id', 'inspectorId')
        .addSelect('COUNT(*)::int', 'cnt')
        .where('u.service_case_id IN (:...caseIds)', { caseIds })
        .andWhere('u.inspector_id IN (:...userIds)', { userIds })
        .andWhere("u.status IN ('submitted','completed')")
        .groupBy('u.service_case_id')
        .addGroupBy('u.inspector_id')
        .getRawMany();
      for (const r of countRows) {
        completedByKey.set(
          `${r.serviceCaseId}:${r.inspectorId}`,
          Number(r.cnt || 0),
        );
      }
    }
    const parseUrls = (v: unknown) =>
      Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v || '[]') : [];
    return raw.map((row) => {
      const startNavUrls = this.normalizeNavUrls(row.startNavUrls, row.startNavUrl);
      const endNavUrls = this.normalizeNavUrls(row.endNavUrls, row.endNavUrl);
      const completedUnits =
        completedByKey.get(`${row.serviceCaseId}:${row.inspectorId}`) || 0;
      return {
      ...row,
      tripSkipped:
        row.tripSkipped === true ||
        row.tripSkipped === 't' ||
        row.tripSkipped === 'true' ||
        row.tripSkipped === 1 ||
        row.tripSkipped === '1',
      voucherUrls: parseUrls(row.voucherUrls),
      lineItems: parseUrls(row.lineItems),
      tollVoucherUrls: parseUrls(row.tollVoucherUrls),
      fuelVoucherUrls: parseUrls(row.fuelVoucherUrls),
      otherVoucherUrls: parseUrls(row.otherVoucherUrls),
      startNavUrls,
      endNavUrls,
      startNavUrl: startNavUrls[0] || row.startNavUrl || null,
      endNavUrl: endNavUrls[0] || row.endNavUrl || null,
      inspectorName: nameMap.get(row.inspectorId) || row.inspectorId,
      caseExpenseTotal: (caseTotals.get(String(row.serviceCaseId)) || 0).toFixed(2),
      completedUnits,
    };
    });
  }

  /** @deprecated 使用 listExpenses；保留兼容旧客户端 */
  async listPendingExpenses(user: CurrentUserContext) {
    return this.listExpenses(user, { status: 'pending' });
  }

  // —— helpers ——
  private normalizeNavShots(shots: unknown): ExpenseNavShot[] {
    if (!Array.isArray(shots)) return [];
    const out: ExpenseNavShot[] = [];
    for (const shot of shots) {
      if (!shot || typeof shot !== 'object') continue;
      const url = String((shot as ExpenseNavShot).url || '').trim();
      if (!url) continue;
      out.push({
        url,
        remark: String((shot as ExpenseNavShot).remark || '').trim().slice(0, 500),
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  private normalizeLineItems(raw: Array<Partial<ExpenseLineItem> & { type?: string; content?: string }>): ExpenseLineItem[] {
    const list = Array.isArray(raw) ? raw : [];
    return list.slice(0, 30).map((item, index) => {
      const type = item?.type === 'trip' || item?.type === 'toll' || item?.type === 'other'
        ? item.type
        : 'other';
      const content =
        type === 'trip'
          ? '行程'
          : type === 'toll'
            ? '过路费'
            : String(item?.content || '').trim().slice(0, 100);
      const startNavShots = this.normalizeNavShots(item?.startNavShots);
      const endNavShots = this.normalizeNavShots(item?.endNavShots);
      const startM =
        item?.startMileage != null && item.startMileage !== ''
          ? Number(item.startMileage)
          : null;
      const endM =
        item?.endMileage != null && item.endMileage !== ''
          ? Number(item.endMileage)
          : null;
      let mileageKm: string | null = null;
      if (
        startM != null &&
        endM != null &&
        Number.isFinite(startM) &&
        Number.isFinite(endM)
      ) {
        if (endM < startM) {
          throw new BadRequestException(`费用明细 ${index + 1}：结束里程不能小于开始里程`);
        }
        mileageKm = (endM - startM).toFixed(1);
      }
      const amount = Math.max(0, Number(item?.amount) || 0);
      return {
        id: String(item?.id || `line-${index + 1}-${Date.now()}`).slice(0, 64),
        type,
        content,
        expenseDate: String(item?.expenseDate || '').trim().slice(0, 32) || null,
        amount: amount.toFixed(2),
        note: String(item?.note || '').trim().slice(0, 1000) || null,
        startOdometerUrl: String(item?.startOdometerUrl || '').trim() || null,
        startMileage: startM != null && Number.isFinite(startM) ? startM.toFixed(1) : null,
        startNavShots,
        endOdometerUrl: String(item?.endOdometerUrl || '').trim() || null,
        endMileage: endM != null && Number.isFinite(endM) ? endM.toFixed(1) : null,
        endNavShots,
        mileageKm,
        voucherUrls: [...new Set((item?.voucherUrls || []).filter(Boolean))].slice(0, 20),
        photoUrls: [...new Set((item?.photoUrls || []).filter(Boolean))].slice(0, 20),
      };
    });
  }

  private applyLineItemsToClaim(claim: CaseExpenseClaim, lines: ExpenseLineItem[]) {
    claim.lineItems = lines;
    claim.tripSkipped = false;
    const trips = lines.filter((l) => l.type === 'trip');
    if (trips.length) {
      // 凭证回退仍用首段；里程汇总按全部行程段
      const first = trips[0];
      claim.startOdometerUrl = first.startOdometerUrl || null;
      claim.startNavUrls = (first.startNavShots || []).map((s) => s.url);
      claim.startNavUrl = claim.startNavUrls[0] || null;
      claim.endOdometerUrl = first.endOdometerUrl || null;
      claim.endNavUrls = (first.endNavShots || []).map((s) => s.url);
      claim.endNavUrl = claim.endNavUrls[0] || null;

      let sumKm = 0;
      let hasKm = false;
      let minStart: number | null = null;
      let maxEnd: number | null = null;
      for (const trip of trips) {
        const startM =
          trip.startMileage != null && trip.startMileage !== ''
            ? Number(trip.startMileage)
            : null;
        const endM =
          trip.endMileage != null && trip.endMileage !== ''
            ? Number(trip.endMileage)
            : null;
        if (startM != null && Number.isFinite(startM)) {
          minStart = minStart == null ? startM : Math.min(minStart, startM);
        }
        if (endM != null && Number.isFinite(endM)) {
          maxEnd = maxEnd == null ? endM : Math.max(maxEnd, endM);
        }
        let km: number | null = null;
        if (trip.mileageKm != null && trip.mileageKm !== '') {
          const n = Number(trip.mileageKm);
          if (Number.isFinite(n)) km = n;
        } else if (
          startM != null &&
          endM != null &&
          Number.isFinite(startM) &&
          Number.isFinite(endM) &&
          endM >= startM
        ) {
          km = Math.round((endM - startM) * 10) / 10;
        }
        if (km != null) {
          sumKm += km;
          hasKm = true;
        }
      }
      claim.startMileage = minStart != null ? minStart.toFixed(1) : null;
      claim.endMileage = maxEnd != null ? maxEnd.toFixed(1) : null;
      claim.mileageKm = hasKm ? sumKm.toFixed(1) : null;
    } else {
      claim.startOdometerUrl = null;
      claim.startMileage = null;
      claim.startNavUrls = [];
      claim.startNavUrl = null;
      claim.endOdometerUrl = null;
      claim.endMileage = null;
      claim.endNavUrls = [];
      claim.endNavUrl = null;
      claim.mileageKm = null;
    }

    const vouchers: string[] = [];
    const notes: string[] = [];
    let total = 0;
    for (const line of lines) {
      total += Number(line.amount || 0);
      if (line.type === 'trip') {
        vouchers.push(...(line.voucherUrls || []));
      } else {
        vouchers.push(...(line.photoUrls || []));
      }
      if (line.note) {
        notes.push(`${line.content || '明细'}：${line.note}`);
      }
    }
    claim.voucherUrls = [...new Set(vouchers.filter(Boolean))].slice(0, 40);
    const sum = Math.max(0, total).toFixed(2);
    claim.claimAmount = sum;
    claim.amount = sum;
    claim.note = notes.length ? notes.join('；').slice(0, 1000) : null;
  }

  private assertLineItemsReady(lines: ExpenseLineItem[]) {
    if (!lines.length) {
      throw new BadRequestException('请至少添加一条费用明细');
    }
    let hasSubstance = false;
    const tripRangeIndex = new Map<string, number[]>();
    lines.forEach((line, index) => {
      const n = index + 1;
      const amount = Number(line.amount || 0);
      if (!line.content?.trim()) {
        throw new BadRequestException(`费用明细 ${n}：请填写内容`);
      }
      if (!line.expenseDate) {
        throw new BadRequestException(`费用明细 ${n}：请选择日期`);
      }
      if (line.type === 'trip') {
        if (!line.startOdometerUrl) {
          throw new BadRequestException(`费用明细 ${n}：请上传开始里程图`);
        }
        if (!(line.startNavShots || []).length) {
          throw new BadRequestException(`费用明细 ${n}：请上传开始导航截图`);
        }
        if (line.startMileage == null || line.startMileage === '') {
          throw new BadRequestException(`费用明细 ${n}：请填写开始里程`);
        }
        if (!line.endOdometerUrl) {
          throw new BadRequestException(`费用明细 ${n}：请上传结束里程图`);
        }
        if (!(line.endNavShots || []).length) {
          throw new BadRequestException(`费用明细 ${n}：请上传结束导航截图`);
        }
        if (line.endMileage == null || line.endMileage === '') {
          throw new BadRequestException(`费用明细 ${n}：请填写结束里程`);
        }
        const startM = Number(line.startMileage);
        const endM = Number(line.endMileage);
        if (Number.isFinite(startM) && Number.isFinite(endM)) {
          const key = `${startM.toFixed(1)}->${endM.toFixed(1)}`;
          const list = tripRangeIndex.get(key) || [];
          list.push(n);
          tripRangeIndex.set(key, list);
        }
        // 行程已有里程/导航作依据，费用凭证可选
        hasSubstance = true;
      } else {
        if (amount <= 0) {
          throw new BadRequestException(`费用明细 ${n}：请填写金额`);
        }
        if (!(line.photoUrls || []).length) {
          throw new BadRequestException(`费用明细 ${n}：请上传照片`);
        }
        hasSubstance = true;
      }
    });
    for (const [key, idxs] of tripRangeIndex) {
      if (idxs.length < 2) continue;
      const [start, end] = key.split('->');
      throw new BadRequestException(
        `行程明细 ${idxs.join('、')} 起止里程完全相同（${start} → ${end}），请核对是否重复填写`,
      );
    }
    if (!hasSubstance) {
      throw new BadRequestException('请完善费用明细后再提交');
    }
  }

  private normalizeNavUrls(urls: unknown, legacy?: string | null): string[] {
    const fromArr = Array.isArray(urls)
      ? urls.filter((u): u is string => typeof u === 'string' && !!u)
      : typeof urls === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(urls);
              return Array.isArray(parsed)
                ? parsed.filter((u): u is string => typeof u === 'string' && !!u)
                : [];
            } catch {
              return [];
            }
          })()
        : [];
    if (fromArr.length) return [...new Set(fromArr)].slice(0, 12);
    return legacy ? [legacy] : [];
  }

  private navUrlList(claim: CaseExpenseClaim, kind: 'start' | 'end'): string[] {
    return kind === 'start'
      ? this.normalizeNavUrls(claim.startNavUrls, claim.startNavUrl)
      : this.normalizeNavUrls(claim.endNavUrls, claim.endNavUrl);
  }

  /** 数组优先；仅传单张时在已有列表为空时写入，避免结束保存冲掉开始导航 */
  private applyNavUrls(
    claim: CaseExpenseClaim,
    kind: 'start' | 'end',
    urls?: string[],
    legacy?: string,
  ) {
    if (urls !== undefined) {
      const list = [...new Set((urls || []).filter(Boolean))].slice(0, 12);
      // 空数组不覆盖已有图：结束保存常带 startNavUrls:[]，会误清空开工已传导航
      if (!list.length && this.navUrlList(claim, kind).length) return;
      if (kind === 'start') {
        claim.startNavUrls = list;
        claim.startNavUrl = list[0] || null;
      } else {
        claim.endNavUrls = list;
        claim.endNavUrl = list[0] || null;
      }
      return;
    }
    if (!legacy) return;
    const existing = this.navUrlList(claim, kind);
    if (existing.includes(legacy)) return;
    if (existing.length) return; // 已有多图时，忽略旧单张字段，避免误覆盖
    if (kind === 'start') {
      claim.startNavUrls = [legacy];
      claim.startNavUrl = legacy;
    } else {
      claim.endNavUrls = [legacy];
      claim.endNavUrl = legacy;
    }
  }

  private async claimUnitInternal(
    serviceCase: ServiceCase,
    unit: CaseWorkUnit,
    inspectorId: string,
    createdBy: string,
  ) {
    unit.status = 'claimed';
    unit.inspectorId = inspectorId;
    unit.claimedAt = new Date();
    await this.units.save(unit);
    const task = await this.workflow.ensureInspectionTaskForUnit(
      serviceCase,
      unit,
      inspectorId,
      createdBy,
    );
    unit.inspectionTaskId = task.id;
    await this.units.save(unit);
    return task;
  }

  private async afterUnitProgress(serviceCase: ServiceCase, user: CurrentUserContext) {
    const extras = await this.detailExtras(serviceCase.id);
    const mine = await this.workflow.myCase(serviceCase.id, user);
    return { ...mine, ...extras };
  }

  /**
   * 多人模式：撤回一名工程师（零完成台、无已提交报告）。
   * 单人请走「改派/换人」，不要用撤回。
   */
  /** 台回到 open 时清空序列号，避免半途放弃仍占用号段 */
  private clearUnitSerial(unit: CaseWorkUnit) {
    unit.deviceSerial = null;
    unit.serialPhotoUrl = null;
    unit.serialConfirmedAt = null;
  }

  private releaseUnitToOpen(unit: CaseWorkUnit) {
    unit.status = 'open';
    unit.inspectorId = null;
    unit.claimedAt = null;
    unit.submittedAt = null;
    unit.inspectionTaskId = null;
    this.clearUnitSerial(unit);
  }

  /** 释放仅认领、尚未提交的作业台（及其未提交巡检任务），用于单人/多人模式切换 */
  private async releaseUnsubmittedClaims(caseId: string) {
    const claimed = await this.units.find({
      where: {
        serviceCaseId: caseId,
        status: In(['claimed']),
      },
    });
    for (const u of claimed) {
      if (u.inspectionTaskId) {
        await this.cases.manager.query(`DELETE FROM inspection_records WHERE task_id = $1`, [
          u.inspectionTaskId,
        ]);
        await this.tasks.delete({ id: u.inspectionTaskId });
      }
      this.releaseUnitToOpen(u);
      await this.units.save(u);
    }
  }

  async withdrawAssignee(caseId: string, inspectorId: string, user: CurrentUserContext) {
    const serviceCase = await this.caseForManager(caseId, user);
    if (['finished', 'settle_review', 'settled', 'month_locked'].includes(serviceCase.status)) {
      throw new BadRequestException('案例已完工或进入结算，不能撤回工程师');
    }
    if ((serviceCase.assignMode || 'single') === 'single') {
      throw new BadRequestException('单人模式请直接「改派工程师」换人，不要使用撤回');
    }
    await this.workflow.assertInspectionTransferable(caseId);

    const assignment = await this.assignments.findOne({
      where: {
        serviceCaseId: caseId,
        inspectorId,
        status: In(['assigned', 'working', 'done']),
      },
    });
    if (!assignment) throw new BadRequestException('该工程师不在本案例派单中');

    const siblings = await this.assignments.find({
      where: {
        serviceCaseId: caseId,
        status: In(['assigned', 'working', 'done']),
      },
    });
    // 多人模式不能只剩 1 人；撤到 0 人（清空待重派）允许
    if (siblings.length === 2) {
      throw new BadRequestException(
        '多人模式至少保留 2 名工程师；若只需 1 人，请先切换为「单人模式」并确认（将自动撤回其余人）',
      );
    }

    const progressed = await this.units.count({
      where: {
        serviceCaseId: caseId,
        inspectorId,
        status: In(['submitted', 'completed', 'accepted', 'settled']),
      },
    });
    if (progressed > 0 || Number(assignment.completedUnits || 0) > 0) {
      throw new BadRequestException('该工程师已有提交/完成台数，不能撤回');
    }

    const claimed = await this.units.find({
      where: {
        serviceCaseId: caseId,
        inspectorId,
        status: In(['claimed']),
      },
    });
    for (const u of claimed) {
      if (u.inspectionTaskId) {
        await this.tasks
          .createQueryBuilder()
          .delete()
          .where('id = :id', { id: u.inspectionTaskId })
          .execute();
        // records cascade may not exist — delete by taskId via manager if needed
        await this.cases.manager.query(`DELETE FROM inspection_records WHERE task_id = $1`, [
          u.inspectionTaskId,
        ]);
      }
      this.releaseUnitToOpen(u);
      await this.units.save(u);
    }

    // 删除该工程师名下、尚未提交的案例任务
    const pendingTasks = await this.tasks.find({
      where: {
        serviceCaseId: caseId,
        inspectorId,
        status: In([TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED]),
      },
    });
    for (const t of pendingTasks) {
      await this.cases.manager.query(`DELETE FROM inspection_records WHERE task_id = $1`, [t.id]);
      await this.tasks.delete(t.id);
    }

    assignment.status = 'withdrawn';
    await this.assignments.save(assignment);

    const actives = await this.assignments.find({
      where: { serviceCaseId: caseId, status: In(['assigned', 'working', 'done']) },
      order: { assignTime: 'ASC' },
    });
    if (!actives.length) {
      serviceCase.inspectorId = null;
      serviceCase.assignBy = null;
      serviceCase.assignTime = null;
      serviceCase.status = 'pending_assign';
    } else {
      serviceCase.inspectorId = actives[0].inspectorId;
      if (serviceCase.status === 'pending_assign') serviceCase.status = 'assigned';
    }
    await this.cases.save(serviceCase);

    await this.logs.write(
      'service_case',
      caseId,
      'assignment_withdraw',
      { inspectorId },
      { remaining: actives.map((a) => a.inspectorId) },
      user.id,
      `撤回工程师 ${inspectorId}`,
    );
    return this.detailExtras(caseId);
  }

  private async assertHiredInspector(siteId: string, inspectorId: string) {
    const inspector = await this.users.findOne({ where: { id: inspectorId } });
    if (!inspector || inspector.status !== CommonStatus.ACTIVE || !userHasRole(inspector, UserRole.INSPECTOR)) {
      throw new BadRequestException('所选账号不是可用工程师');
    }
    // reuse workflow available check via raw member query in workflow.assign — call site members through cases manager
    const rows = await this.cases.manager.query(
      `SELECT 1 FROM site_members WHERE site_id=$1 AND user_id=$2 AND status='active' AND member_role='inspector' LIMIT 1`,
      [siteId, inspectorId],
    );
    if (!rows?.length) throw new BadRequestException('只能派给该网格已入职的工程师');
  }

  private async caseForManager(caseId: string, user: CurrentUserContext) {
    const serviceCase = await this.cases.findOne({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('案例不存在');
    this.scope.assertCaseAccess(user, serviceCase);
    return serviceCase;
  }

  private async caseForAssignee(caseId: string, user: CurrentUserContext) {
    if (user.role !== UserRole.INSPECTOR) {
      throw new BadRequestException('仅工程师可执行');
    }
    const serviceCase = await this.cases.findOne({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('案例不存在');
    const assignment = await this.assignments.findOne({
      where: {
        serviceCaseId: caseId,
        inspectorId: user.id,
        status: In(['assigned', 'working', 'done']),
      },
    });
    if (!assignment && serviceCase.inspectorId !== user.id) {
      throw new NotFoundException('案例不存在或未派给当前账号');
    }
    return serviceCase;
  }

  private async caseForManagerOrAssignee(caseId: string, user: CurrentUserContext) {
    if (user.role === UserRole.INSPECTOR) return this.caseForAssignee(caseId, user);
    return this.caseForManager(caseId, user);
  }
}
