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
  Device,
  InspectionTask,
  ServiceCase,
  Site,
  SiteMember,
} from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import {
  CommonStatus,
  SiteMemberRole,
  TaskStatus,
  UserRole,
  WorkTaskType,
} from '../../../common/enums';
import { TemplateService } from '../../template/template.service';
import { ChangeLogService } from './change-log.service';
import { FinanceScopeService } from './finance-scope.service';
import {
  BatchAssignCasesToSitesDto,
  BatchCreateTasksFromCasesDto,
  SetCaseSiteDto,
  SetCaseTaskTypeDto,
} from '../dto/finance.dto';

/** 案例 ↔ 站点 ↔ 任务桥接 */
@Injectable()
export class CaseBridgeService {
  constructor(
    @InjectRepository(ServiceCase) private readonly cases: Repository<ServiceCase>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(InspectionTask) private readonly tasks: Repository<InspectionTask>,
    @InjectRepository(SiteMember) private readonly members: Repository<SiteMember>,
    @InjectRepository(CaseWorkRecord) private readonly work: Repository<CaseWorkRecord>,
    private readonly templates: TemplateService,
    private readonly scope: FinanceScopeService,
    private readonly logs: ChangeLogService,
  ) {}

  async setSite(caseId: string, dto: SetCaseSiteDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    const item = await this.getCase(caseId, user);
    const site = await this.getSite(dto.siteId);
    this.assertCanAssignSite(user, site.id);
    const prev = item.siteId;
    item.siteId = site.id;
    await this.cases.save(item);
    await this.logs.write(
      'service_case',
      caseId,
      'site_id',
      prev,
      site.id,
      user.id,
      `案例归属站点 → ${site.name}`,
    );
    return item;
  }

  async batchAssignSites(dto: BatchAssignCasesToSitesDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    if (!dto.caseIds?.length) throw new BadRequestException('请选择案例');
    const site = await this.getSite(dto.siteId);
    this.assertCanAssignSite(user, site.id);
    const list = await this.cases.find({ where: { id: In(dto.caseIds) } });
    if (!list.length) throw new NotFoundException('未找到案例');
    for (const item of list) {
      await this.scope.assertRegion(user, item.region);
      item.siteId = site.id;
    }
    await this.cases.save(list);
    await this.logs.write(
      'service_case',
      'batch',
      'site_id',
      null,
      { siteId: site.id, count: list.length },
      user.id,
      `批量分配 ${list.length} 个案例到站点 ${site.name}`,
    );
    return { updated: list.length, siteId: site.id, siteName: site.name };
  }

  async setTaskType(caseId: string, dto: SetCaseTaskTypeDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    const item = await this.getCase(caseId, user);
    if (!item.siteId) throw new BadRequestException('请先将案例分配到站点');
    this.assertSiteManage(user, item.siteId);
    const prev = item.taskType;
    item.taskType = dto.taskType;
    await this.cases.save(item);
    await this.logs.write(
      'service_case',
      caseId,
      'task_type',
      prev,
      dto.taskType,
      user.id,
      `设置任务类型 → ${dto.taskType}`,
    );
    return item;
  }

  /**
   * 站点按案例批量创建任务：
   * - inspection：创建巡检任务（需 deviceId），可选派工程师
   * - service：不建巡检任务，可选直接派本站工程师到案例
   */
  async batchCreateTasks(dto: BatchCreateTasksFromCasesDto, user: CurrentUserContext) {
    this.assertAdminOrManager(user);
    if (!dto.caseIds?.length) throw new BadRequestException('请选择案例');

    const list = await this.cases.find({ where: { id: In(dto.caseIds) } });
    if (!list.length) throw new NotFoundException('未找到案例');

    const createdTaskIds: string[] = [];
    const serviceAssigned: string[] = [];
    const skipped: Array<{ caseId: string; reason: string }> = [];

    for (const item of list) {
      await this.scope.assertRegion(user, item.region);
      if (!item.siteId) {
        skipped.push({ caseId: item.id, reason: '未分配站点' });
        continue;
      }
      this.assertSiteManage(user, item.siteId);
      if (!item.taskType) {
        skipped.push({ caseId: item.id, reason: '未设置任务类型' });
        continue;
      }

      if (item.taskType === WorkTaskType.SERVICE) {
        if (dto.inspectorId) {
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
        } else {
          skipped.push({
            caseId: item.id,
            reason: '服务作业类型请指定本站工程师，或仅保留案例待派单',
          });
        }
        continue;
      }

      // inspection
      const exists = await this.tasks.findOne({
        where: { serviceCaseId: item.id },
      });
      if (exists) {
        skipped.push({ caseId: item.id, reason: '已存在关联任务' });
        continue;
      }
      if (!dto.deviceId) {
        skipped.push({ caseId: item.id, reason: '巡检类型须指定设备' });
        continue;
      }
      const device = await this.devices.findOne({
        where: { id: dto.deviceId, siteId: item.siteId },
      });
      if (!device) {
        skipped.push({ caseId: item.id, reason: '设备不属于该站点' });
        continue;
      }
      if (dto.inspectorId) {
        await this.assertHired(item.siteId, dto.inspectorId);
      }

      const template = await this.templates.resolveForDevice(device.deviceType, item.siteId);
      if (!template) {
        skipped.push({
          caseId: item.id,
          reason: `未找到设备类型「${device.deviceType}」的巡检模板`,
        });
        continue;
      }

      const task = this.tasks.create({
        siteId: item.siteId,
        deviceId: device.id,
        taskName: `${item.gspCaseNo}-${item.projectName || '巡检'}`.slice(0, 120),
        inspectorId: dto.inspectorId || null,
        createdBy: user.id,
        serviceCaseId: item.id,
        taskType: WorkTaskType.INSPECTION,
        status: TaskStatus.PENDING,
        plannedDate: null,
        aiEnabled: dto.aiEnabled !== false,
        templateSnapshot: template.entries,
      } as Partial<InspectionTask>);
      const saved = await this.tasks.save(task);
      createdTaskIds.push(saved.id);

      if (dto.inspectorId) {
        item.inspectorId = dto.inspectorId;
        item.assignBy = user.id;
        item.assignTime = new Date();
        item.status = 'assigned';
        await this.cases.save(item);
      }
    }

    return {
      createdTasks: createdTaskIds.length,
      serviceAssigned: serviceAssigned.length,
      skipped,
      taskIds: createdTaskIds,
    };
  }

  private async getCase(id: string, user: CurrentUserContext) {
    const item = await this.cases.findOne({ where: { id } });
    if (!item) throw new NotFoundException('案例不存在');
    await this.scope.assertRegion(user, item.region);
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
