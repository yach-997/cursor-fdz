import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  CaseWorkRecord,
  InspectionTemplate,
  ServiceCase,
  Site,
  SiteMember,
} from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import {
  CommonStatus,
  SiteMemberRole,
  UserRole,
} from '../../../common/enums';
import { ChangeLogService } from './change-log.service';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceWorkflowService } from './finance-workflow.service';
import {
  BatchAssignCasesToSitesDto,
  BatchCreateTasksFromCasesDto,
  SetCaseSiteDto,
  SetCaseTaskTypeDto,
} from '../dto/finance.dto';

/** 案例 ↔ 网格桥接（派单时自动创建巡检任务） */
@Injectable()
export class CaseBridgeService {
  constructor(
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(SiteMember) private readonly members: Repository<SiteMember>,
    @InjectRepository(CaseWorkRecord) private readonly work: Repository<CaseWorkRecord>,
    @InjectRepository(InspectionTemplate)
    private readonly templates: Repository<InspectionTemplate>,
    private readonly workflow: FinanceWorkflowService,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
  ) {}

  async setSite(caseId: string, dto: SetCaseSiteDto, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可分配/改派网格');
    }
    const item = await this.getCase(caseId, user);
    this.assertCaseSiteTransferable(item);
    const site = await this.getSite(dto.siteId);
    this.assertCanAssignSite(user, site.id);
    const prev = item.siteId;
    const siteChanged = prev !== site.id;
    if (!siteChanged) return item;

    if (item.inspectorId || item.status !== 'pending_assign') {
      await this.workflow.resetDispatchForSiteTransfer(item);
      // resetDispatch 已写回 pending_assign / 清空工程师；此处再保险一次
      item.inspectorId = null;
      item.assignBy = null;
      item.assignTime = null;
      item.completedUnits = 0;
      item.status = 'pending_assign';
    }

    item.siteId = site.id;
    await this.cases.save(item);
    await this.logs.write(
      'service_case',
      caseId,
      'site_id',
      prev,
      site.id,
      user.id,
      prev
        ? `改派网格 → ${site.name}（原派单已清空，请新网格重新派单）`
        : `案例归属网格 → ${site.name}`,
    );
    return item;
  }

  async batchAssignSites(dto: BatchAssignCasesToSitesDto, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可分配/改派网格');
    }
    if (!dto.caseIds?.length) throw new BadRequestException('请选择案例');
    const site = await this.getSite(dto.siteId);
    this.assertCanAssignSite(user, site.id);
    const list = await this.cases.find({ where: { id: In(dto.caseIds) } });
    if (!list.length) throw new NotFoundException('未找到案例');
    let updated = 0;
    const skipped: Array<{ caseId: string; reason: string }> = [];
    for (const item of list) {
      try {
        this.assertCaseSiteTransferable(item);
        if (item.siteId === site.id) {
          // 已在目标网格：跳过，不当作改派成功
          continue;
        }
        if (item.inspectorId || item.status !== 'pending_assign') {
          await this.workflow.resetDispatchForSiteTransfer(item);
          item.inspectorId = null;
          item.assignBy = null;
          item.assignTime = null;
          item.completedUnits = 0;
          item.status = 'pending_assign';
        }
        item.siteId = site.id;
        await this.cases.save(item);
        updated += 1;
      } catch (err) {
        skipped.push({
          caseId: item.gspCaseNo || item.id,
          reason: err instanceof Error ? err.message : '不可改派网格',
        });
      }
    }
    await this.logs.write(
      'service_case',
      'batch',
      'site_id',
      null,
      { siteId: site.id, count: updated },
      user.id,
      `批量分配/改派 ${updated} 个案例到网格 ${site.name}`,
    );
    return { updated, siteId: site.id, siteName: site.name, skipped };
  }

  private assertCaseSiteTransferable(item: ServiceCase) {
    if (
      ['finished', 'settle_review', 'settled', 'month_locked'].includes(item.status)
    ) {
      throw new BadRequestException('案例已完工或进入结算，不能改派网格');
    }
  }

  private assertCaseTaskTypeEditable(item: ServiceCase) {
    if (['working', 'finished', 'settle_review', 'settled', 'month_locked'].includes(item.status)) {
      throw new BadRequestException(
        '案例已开始作业或进入结算，不能再修改服务类型（避免与已建巡检模板不一致）',
      );
    }
  }

  async setTaskType(caseId: string, dto: SetCaseTaskTypeDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    const item = await this.getCase(caseId, user);
    if (!item.siteId) throw new BadRequestException('请先将案例分配到网格');
    this.assertSiteManage(user, item.siteId);
    this.assertCaseTaskTypeEditable(item);
    const template = await this.templates.findOne({ where: { id: dto.templateId } });
    if (!template) throw new NotFoundException('服务类型不存在，请先在「服务类型」中创建');
    const prev = {
      taskType: item.taskType,
      taskTemplateId: item.taskTemplateId,
      productLine: item.productLine,
    };
    const lines = Array.isArray(template.productLines) ? template.productLines : [];
    let productLine = String(dto.productLine || item.productLine || '').trim() || null;
    if (productLine) {
      const matched = lines.find((p) => String(p.name || '').trim() === productLine) || null;
      if (!matched) {
        throw new BadRequestException(
          lines.length
            ? `产品线「${productLine}」不在服务类型「${template.name}」下（需精确同名），请先在「服务类型」新增该产品线`
            : `服务类型「${template.name}」尚未配置产品线，案例需要「${productLine}」，请先在「服务类型」新增同名产品线`,
        );
      }
      if (!matched.entries?.length) {
        throw new BadRequestException(`产品线「${matched.name}」尚未配置检查条目`);
      }
      productLine = matched.name;
    } else if (lines.length) {
      throw new BadRequestException('该服务类型已配置产品线，请选择产品线');
    } else {
      if (!template.entries?.length) {
        throw new BadRequestException('服务类型尚未配置检查条目');
      }
      productLine = null;
    }

    item.taskTemplateId = template.id;
    item.taskType = String(template.name || '').slice(0, 128) || template.id;
    item.productLine = productLine;
    item.unitLabel = '台';
    // 派单模式在派单时选择；报销由工程师按需填写
    item.expenseEnabled = true;
    if (!item.assignMode) item.assignMode = 'single';
    if (item.assignMode === 'single') item.plannedUnits = 1;
    await this.cases.save(item);
    await this.logs.write(
      'service_case',
      caseId,
      'task_type',
      prev,
      {
        taskType: item.taskType,
        taskTemplateId: item.taskTemplateId,
        productLine: item.productLine,
      },
      user.id,
      productLine
        ? `设置服务类型 → ${item.taskType} / ${productLine}`
        : `设置服务类型 → ${item.taskType}`,
    );
    return item;
  }

  /**
   * 按案例批量派单：派工程师并创建带 AI 分析的规范巡检任务。
   */
  async batchCreateTasks(dto: BatchCreateTasksFromCasesDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    if (!dto.caseIds?.length) throw new BadRequestException('请选择案例');
    if (!dto.inspectorId) throw new BadRequestException('请指定本网格工程师');

    const list = await this.cases.find({ where: { id: In(dto.caseIds) } });
    if (!list.length) throw new NotFoundException('未找到案例');

    const serviceAssigned: string[] = [];
    const taskIds: string[] = [];
    const skipped: Array<{ caseId: string; reason: string }> = [];

    for (const item of list) {
      if (!item.siteId) {
        skipped.push({ caseId: item.id, reason: '未分配网格' });
        continue;
      }
      this.assertSiteManage(user, item.siteId);
      if (!item.taskTemplateId && !item.taskType) {
        skipped.push({ caseId: item.id, reason: '未设置服务类型' });
        continue;
      }
      if (item.taskTemplateId) {
        const tpl = await this.templates.findOne({ where: { id: item.taskTemplateId } });
        const lines = Array.isArray(tpl?.productLines) ? tpl!.productLines : [];
        if (lines.length && !String(item.productLine || '').trim()) {
          skipped.push({ caseId: item.id, reason: '未选择产品线' });
          continue;
        }
      }
      if (item.status !== 'pending_assign') {
        skipped.push({ caseId: item.id, reason: '案例已派单或已进入后续状态' });
        continue;
      }
      await this.assertHired(item.siteId, dto.inspectorId);
      item.inspectorId = dto.inspectorId;
      item.assignBy = user.id;
      item.assignTime = new Date();
      item.status = 'assigned';
      await this.cases.save(item);
      await this.ensureWorkRecord(item, dto.inspectorId);
      serviceAssigned.push(item.id);
      try {
        const task = await this.workflow.ensureInspectionTask(
          item,
          dto.inspectorId,
          user.id,
        );
        taskIds.push(task.id);
      } catch (err) {
        skipped.push({
          caseId: item.id,
          reason: err instanceof Error ? `已派单但巡检任务未创建：${err.message}` : '已派单但巡检任务未创建',
        });
      }
      await this.logs.write(
        'service_case',
        item.id,
        'status',
        'pending_assign',
        'assigned',
        user.id,
        `案例派单 → ${dto.inspectorId}`,
      );
    }

    return {
      createdTasks: taskIds.length,
      serviceAssigned: serviceAssigned.length,
      skipped,
      taskIds,
    };
  }

  private async getCase(id: string, user: CurrentUserContext) {
    const item = await this.cases.findOne({ where: { id } });
    if (!item) throw new NotFoundException('案例不存在');
    this.scope.assertCaseAccess(user, item);
    return item;
  }

  private async getSite(id: string) {
    const site = await this.sites.findOne({ where: { id, deletedAt: IsNull() } });
    if (!site) throw new NotFoundException('网格不存在');
    return site;
  }

  private assertAdminOrManager(user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.SITE_MANAGER) {
      throw new ForbiddenException('无权操作');
    }
  }

  private assertCanAssignSite(user: CurrentUserContext, siteId: string) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (!user.managedSiteIds?.includes(siteId)) {
      throw new ForbiddenException('只能分配到自己管理的网格');
    }
  }

  private assertSiteManage(user: CurrentUserContext, siteId: string) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (!user.managedSiteIds?.includes(siteId)) {
      throw new ForbiddenException('无权操作该网格案例');
    }
  }

  private async assertHired(siteId: string, inspectorId: string) {
    const hit = await this.members.findOne({
      where: {
        siteId,
        userId: inspectorId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.INSPECTOR,
      },
    });
    if (!hit) throw new BadRequestException('工程师不属于该网格，请先入职');
  }

  private async ensureWorkRecord(item: ServiceCase, inspectorId: string) {
    let work = await this.work.findOne({ where: { serviceCaseId: item.id } });
    work ||= this.work.create({
      serviceCaseId: item.id,
      gspCaseNo: item.gspCaseNo,
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
  }
}
