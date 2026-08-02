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

/** 案例 ↔ 站点桥接（派单时自动创建 AI 巡检任务） */
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
      throw new ForbiddenException('仅管理员可分配/改派站点');
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
      item.inspectorId = null;
      item.assignBy = null;
      item.assignTime = null;
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
        ? `改派站点 → ${site.name}（原派单已清空，请新站点重新派单）`
        : `案例归属站点 → ${site.name}`,
    );
    return item;
  }

  async batchAssignSites(dto: BatchAssignCasesToSitesDto, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可分配/改派站点');
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
          updated += 1;
          continue;
        }
        if (item.inspectorId || item.status !== 'pending_assign') {
          await this.workflow.resetDispatchForSiteTransfer(item);
          item.inspectorId = null;
          item.assignBy = null;
          item.assignTime = null;
          item.status = 'pending_assign';
        }
        item.siteId = site.id;
        await this.cases.save(item);
        updated += 1;
      } catch (err) {
        skipped.push({
          caseId: item.gspCaseNo || item.id,
          reason: err instanceof Error ? err.message : '不可改派站点',
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
      `批量分配/改派 ${updated} 个案例到站点 ${site.name}`,
    );
    return { updated, siteId: site.id, siteName: site.name, skipped };
  }

  private assertCaseSiteTransferable(item: ServiceCase) {
    if (
      ['finished', 'settle_review', 'settled', 'month_locked'].includes(item.status)
    ) {
      throw new BadRequestException('案例已完工或进入结算，不能改派站点');
    }
  }

  async setTaskType(caseId: string, dto: SetCaseTaskTypeDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    const item = await this.getCase(caseId, user);
    if (!item.siteId) throw new BadRequestException('请先将案例分配到站点');
    this.assertSiteManage(user, item.siteId);
    const template = await this.templates.findOne({ where: { id: dto.templateId } });
    if (!template) throw new NotFoundException('任务类型不存在，请先在「任务类型」中创建');
    const prev = { taskType: item.taskType, taskTemplateId: item.taskTemplateId };
    item.taskTemplateId = template.id;
    item.taskType = String(template.name || '').slice(0, 128) || template.id;
    await this.cases.save(item);
    await this.logs.write(
      'service_case',
      caseId,
      'task_type',
      prev,
      { taskType: item.taskType, taskTemplateId: item.taskTemplateId },
      user.id,
      `设置任务类型 → ${item.taskType}`,
    );
    return item;
  }

  /**
   * 按案例批量派单：派工程师并创建带 AI 分析的规范巡检任务。
   */
  async batchCreateTasks(dto: BatchCreateTasksFromCasesDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    if (!dto.caseIds?.length) throw new BadRequestException('请选择案例');
    if (!dto.inspectorId) throw new BadRequestException('请指定本站工程师');

    const list = await this.cases.find({ where: { id: In(dto.caseIds) } });
    if (!list.length) throw new NotFoundException('未找到案例');

    const serviceAssigned: string[] = [];
    const taskIds: string[] = [];
    const skipped: Array<{ caseId: string; reason: string }> = [];

    for (const item of list) {
      if (!item.siteId) {
        skipped.push({ caseId: item.id, reason: '未分配站点' });
        continue;
      }
      this.assertSiteManage(user, item.siteId);
      if (!item.taskTemplateId && !item.taskType) {
        skipped.push({ caseId: item.id, reason: '未设置任务类型' });
        continue;
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
    if (!site) throw new NotFoundException('站点不存在');
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
      throw new ForbiddenException('只能分配到自己管理的站点');
    }
  }

  private assertSiteManage(user: CurrentUserContext, siteId: string) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (!user.managedSiteIds?.includes(siteId)) {
      throw new ForbiddenException('无权操作该站点案例');
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
    if (!hit) throw new BadRequestException('工程师不属于该站点，请先入职');
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
