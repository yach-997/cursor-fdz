import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import {
  InspectionTask,
  InspectionRecord,
  Device,
  Site,
  SiteMember,
  User,
  RecordEntry,
} from '../../entities';
import {
  UserRole,
  CommonStatus,
  TaskStatus,
  RecordStatus,
  CheckResult,
  SiteMemberRole,
} from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { userHasRole } from '../../common/utils/user-roles';
import { TemplateService } from '../template/template.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  ReassignTaskDto,
} from './dto/task.dto';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
    @InjectRepository(InspectionRecord)
    private readonly recordRepo: Repository<InspectionRecord>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteMember)
    private readonly memberRepo: Repository<SiteMember>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly templateService: TemplateService,
  ) {}

  /** 任务列表（含数据隔离） */
  async findAll(query: QueryTaskDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;

    // 使用 QueryBuilder + 数据库列名排序，避免 findAndCount+relations 的 orderBy 缺陷
    const qb = this.taskRepo.createQueryBuilder('task');

    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.length) {
        return { list: [], total: 0, page, limit };
      }
      if (query.siteId) {
        this.assertSiteAccess(query.siteId, currentUser);
        qb.andWhere('task.site_id = :siteId', { siteId: query.siteId });
      } else {
        qb.andWhere('task.site_id IN (:...siteIds)', {
          siteIds: currentUser.managedSiteIds,
        });
      }
    } else if (currentUser.role === UserRole.INSPECTOR) {
      qb.andWhere('task.inspector_id = :inspectorId', {
        inspectorId: currentUser.id,
      });
      if (query.siteId) {
        this.assertSiteAccess(query.siteId, currentUser);
        qb.andWhere('task.site_id = :siteId', { siteId: query.siteId });
      }
    } else if (query.siteId) {
      qb.andWhere('task.site_id = :siteId', { siteId: query.siteId });
    }

    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    } else if (query.statusGroup) {
      const group = query.statusGroup;
      if (group === 'not_started') {
        qb.andWhere('task.status = :st', { st: TaskStatus.PENDING });
      } else if (group === 'in_progress') {
        qb.andWhere('task.status IN (:...sts)', {
          sts: [TaskStatus.IN_PROGRESS, TaskStatus.REJECTED],
        });
      } else if (group === 'completed') {
        qb.andWhere('task.status IN (:...sts)', {
          sts: [TaskStatus.SUBMITTED, TaskStatus.APPROVED],
        });
      } else if (group === 'archived') {
        qb.andWhere('task.status = :st', { st: TaskStatus.ARCHIVED });
      }
    }
    if (query.inspectorId && currentUser.role !== UserRole.INSPECTOR) {
      qb.andWhere('task.inspector_id = :filterInspector', {
        filterInspector: query.inspectorId,
      });
    }
    if (query.keyword) {
      qb.andWhere('task.task_name ILIKE :kw', { kw: `%${query.keyword}%` });
    }
    // 按创建时间筛选（不再使用计划日期）
    if (query.startDate) {
      qb.andWhere('task.created_at >= :startDate', {
        startDate: `${query.startDate} 00:00:00`,
      });
    }
    if (query.endDate) {
      qb.andWhere('task.created_at <= :endDate', {
        endDate: `${query.endDate} 23:59:59`,
      });
    }
    if (query.region) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM sites s
          WHERE s.id = task.site_id
            AND (
              s.name ILIKE :region
              OR s.province ILIKE :region
              OR s.city ILIKE :region
              OR s.district ILIKE :region
              OR CONCAT(s.province, s.city, s.district) ILIKE :region
            )
        )`,
        { region: `%${query.region.trim()}%` },
      );
    }
    if (query.deviceType) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM devices d WHERE d.id = task.device_id AND d.device_type = :deviceType)`,
        { deviceType: query.deviceType },
      );
    }

    qb.orderBy('task.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [list, total] = await qb.getManyAndCount();
    await this.attachRelations(list);
    const recordMap = await this.attachLatestRecords(list);

    return {
      list: list.map((t) => {
        const rec = recordMap.get(t.id);
        return {
          ...this.toSafe(t, rec?.status, !!rec?.rejectReason?.reason),
          record: rec
            ? {
                id: rec.id,
                status: rec.status,
                rejectReason: rec.rejectReason,
              }
            : null,
        };
      }),
      total,
      page,
      limit,
    };
  }

  /** 批量挂载站点/设备/工程师，避免 find relations 的 TypeORM orderBy 缺陷 */
  private async attachRelations(tasks: InspectionTask[]) {
    if (!tasks.length) return;
    const siteIds = [...new Set(tasks.map((t) => t.siteId))];
    const deviceIds = [...new Set(tasks.map((t) => t.deviceId))];
    const inspectorIds = [...new Set(tasks.map((t) => t.inspectorId))];

    const [sites, devices, inspectors] = await Promise.all([
      this.siteRepo.findBy({ id: In(siteIds) }),
      this.deviceRepo.findBy({ id: In(deviceIds) }),
      this.userRepo.findBy({ id: In(inspectorIds) }),
    ]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const deviceMap = new Map(devices.map((d) => [d.id, d]));
    const inspectorMap = new Map(inspectors.map((u) => [u.id, u]));

    for (const t of tasks) {
      t.site = siteMap.get(t.siteId)!;
      t.device = deviceMap.get(t.deviceId)!;
      t.inspector = inspectorMap.get(t.inspectorId)!;
    }
  }

  /** 每任务最新一条巡检记录；若最新无驳回信息则合并历史驳回 */
  private async attachLatestRecords(tasks: InspectionTask[]) {
    const map = new Map<string, InspectionRecord>();
    if (!tasks.length) return map;
    const ids = tasks.map((t) => t.id);
    const records = await this.recordRepo
      .createQueryBuilder('r')
      .where('r.task_id IN (:...ids)', { ids })
      .orderBy('r.created_at', 'DESC')
      .getMany();
    const rejectByTask = new Map<string, InspectionRecord['rejectReason']>();
    for (const r of records) {
      if (!map.has(r.taskId)) map.set(r.taskId, r);
      if (r.rejectReason?.reason && !rejectByTask.has(r.taskId)) {
        rejectByTask.set(r.taskId, r.rejectReason);
      }
    }
    for (const [taskId, rec] of map) {
      if (!rec.rejectReason?.reason && rejectByTask.has(taskId)) {
        rec.rejectReason = rejectByTask.get(taskId)!;
      }
    }
    return map;
  }

  async findOne(id: string, currentUser: CurrentUserContext) {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在');
    this.assertTaskAccess(task, currentUser);

    await this.attachRelations([task]);
    const creator = await this.userRepo.findOne({ where: { id: task.createdBy } });
    if (creator) task.creator = creator;

    const records = await this.recordRepo.find({
      where: { taskId: id },
      order: { createdAt: 'DESC' },
    });
    const record = records[0];
    // 若当前是新开的空进度、驳回信息在历史记录上，一并带回给工程师
    const rejectReason =
      record?.rejectReason ||
      records.find((r) => r.rejectReason?.reason)?.rejectReason ||
      null;
    return {
      ...this.toSafe(task, record?.status, !!rejectReason?.reason),
      templateSnapshot: task.templateSnapshot,
      record: record
        ? {
            id: record.id,
            status: record.status,
            entries: record.entries,
            rejectReason,
          }
        : null,
    };
  }

  /** 创建任务：管理员/工程师均可；按站点+序列号关联设备，存模板快照 */
  async create(dto: CreateTaskDto, currentUser: CurrentUserContext) {
    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      currentUser.role !== UserRole.SITE_MANAGER &&
      currentUser.role !== UserRole.INSPECTOR
    ) {
      throw new ForbiddenException('无权创建任务');
    }
    this.assertSiteAccess(dto.siteId, currentUser);

    const site = await this.siteRepo.findOne({
      where: { id: dto.siteId, deletedAt: IsNull() },
    });
    if (!site) throw new NotFoundException('站点不存在');

    const device = await this.resolveDevice(dto.siteId, dto.deviceId, dto.serialNumber);

    let inspectorId = dto.inspectorId;
    if (currentUser.role === UserRole.INSPECTOR) {
      // 工程师自建任务：默认本人
      inspectorId = currentUser.id;
    }
    if (!inspectorId) {
      throw new BadRequestException('请指定工程师');
    }
    await this.assertHiredInspector(dto.siteId, inspectorId);

    const template = await this.templateService.resolveForDevice(
      device.deviceType,
      dto.siteId,
    );
    if (!template) {
      throw new BadRequestException(
        `未找到设备类型「${device.deviceType}」的巡检模板，请先配置模板`,
      );
    }

    const task = this.taskRepo.create({
      siteId: dto.siteId,
      deviceId: device.id,
      taskName: dto.taskName,
      inspectorId,
      createdBy: currentUser.id,
      status: TaskStatus.PENDING,
      plannedDate: null,
      aiEnabled: dto.aiEnabled !== false,
      templateSnapshot: template.entries,
    } as Partial<InspectionTask>);

    const saved = await this.taskRepo.save(task);
    return this.findOne(saved.id, currentUser);
  }

  async update(id: string, dto: UpdateTaskDto, currentUser: CurrentUserContext) {
    const task = await this.getTaskOrThrow(id);
    this.assertTaskManage(task, currentUser);
    if (task.status !== TaskStatus.PENDING) {
      throw new BadRequestException('仅未开始的任务可编辑');
    }

    if (dto.taskName !== undefined) task.taskName = dto.taskName;
    if (dto.aiEnabled !== undefined) task.aiEnabled = dto.aiEnabled;

    const nextSiteId = dto.siteId || task.siteId;
    if (dto.siteId) {
      this.assertSiteAccess(dto.siteId, currentUser);
      task.siteId = dto.siteId;
    }

    if (dto.deviceId || dto.serialNumber || dto.siteId) {
      const device = await this.resolveDevice(
        nextSiteId,
        dto.deviceId || task.deviceId,
        dto.serialNumber,
      );
      task.deviceId = device.id;
      const template = await this.templateService.resolveForDevice(
        device.deviceType,
        nextSiteId,
      );
      if (!template) {
        throw new BadRequestException(
          `未找到设备类型「${device.deviceType}」的巡检模板，请先配置模板`,
        );
      }
      task.templateSnapshot = template.entries;
    }

    if (dto.inspectorId) {
      await this.assertHiredInspector(nextSiteId, dto.inspectorId);
      task.inspectorId = dto.inspectorId;
    }

    await this.taskRepo.save(task);
    return this.findOne(id, currentUser);
  }

  /**
   * 开始巡检：pending → in_progress，创建 InspectionRecord；
   * 驳回后重新打开时复用原记录（保留照片与驳回信息）。
   */
  async start(id: string, currentUser: CurrentUserContext) {
    const task = await this.getTaskOrThrow(id);
    this.assertTaskAccess(task, currentUser);

    // 工程师只能开始自己的任务；站长/超管也可代开始
    if (
      currentUser.role === UserRole.INSPECTOR &&
      task.inspectorId !== currentUser.id
    ) {
      throw new ForbiddenException('只能开始分配给自己的任务');
    }

    if (task.status === TaskStatus.IN_PROGRESS) {
      return this.findOne(id, currentUser);
    }
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.REJECTED) {
      throw new BadRequestException('当前状态不可开始巡检');
    }

    const device = await this.deviceRepo.findOne({ where: { id: task.deviceId } });
    if (!device) throw new NotFoundException('设备不存在');

    if (task.status === TaskStatus.REJECTED) {
      const rejected = await this.recordRepo.findOne({
        where: { taskId: id, status: RecordStatus.REJECTED },
        order: { createdAt: 'DESC' },
      });
      if (rejected) {
        rejected.status = RecordStatus.DRAFT;
        const trail = Array.isArray(rejected.auditTrail) ? rejected.auditTrail : [];
        rejected.auditTrail = [
          ...trail,
          {
            action: 'reopened' as const,
            at: new Date().toISOString(),
            by: currentUser.id,
            byName: currentUser.realName,
            summary: '驳回后重新打开任务返工',
            reason: rejected.rejectReason?.reason,
            entryIds: rejected.rejectReason?.entryIds,
          },
        ];
        await this.recordRepo.save(rejected);
      } else {
        const entries = this.buildDraftEntries(task.templateSnapshot || []);
        await this.recordRepo.save(
          this.recordRepo.create({
            taskId: id,
            deviceType: device.deviceType,
            entries,
            status: RecordStatus.DRAFT,
            reportPhotos: null,
            auditTrail: [],
          } as Partial<InspectionRecord>),
        );
      }
    } else {
      let record = await this.recordRepo.findOne({
        where: { taskId: id, status: RecordStatus.DRAFT },
      });
      if (!record) {
        record = this.recordRepo.create({
          taskId: id,
          deviceType: device.deviceType,
          entries: this.buildDraftEntries(task.templateSnapshot || []),
          status: RecordStatus.DRAFT,
          reportPhotos: null,
          auditTrail: [],
        } as Partial<InspectionRecord>);
      }
      await this.recordRepo.save(record);
    }

    task.status = TaskStatus.IN_PROGRESS;
    task.startedAt = task.startedAt || new Date();
    await this.taskRepo.save(task);

    return this.findOne(id, currentUser);
  }

  /** 归档任务（仅管理员） */
  async archive(id: string, currentUser: CurrentUserContext) {
    const task = await this.getTaskOrThrow(id);
    this.assertTaskManage(task, currentUser);

    if (task.status === TaskStatus.ARCHIVED) {
      return this.findOne(id, currentUser);
    }
    if (
      task.status !== TaskStatus.PENDING &&
      task.status !== TaskStatus.IN_PROGRESS &&
      task.status !== TaskStatus.REJECTED &&
      task.status !== TaskStatus.APPROVED
    ) {
      throw new BadRequestException('待审核任务不可归档，请先完成审核');
    }

    task.status = TaskStatus.ARCHIVED;
    await this.taskRepo.save(task);
    return this.findOne(id, currentUser);
  }

  /**
   * 删除未完成任务（管理员本站 / 工程师本人）
   * 已提交、已通过的不可删
   */
  async remove(id: string, currentUser: CurrentUserContext) {
    const task = await this.getTaskOrThrow(id);
    this.assertTaskDelete(task, currentUser);

    if (
      task.status === TaskStatus.SUBMITTED ||
      task.status === TaskStatus.APPROVED
    ) {
      throw new BadRequestException('已提交或已完成的任务不能删除');
    }

    await this.recordRepo.delete({ taskId: id });
    await this.taskRepo.delete(id);
    return { success: true, id };
  }

  /** 改派工程师 */
  async reassign(id: string, dto: ReassignTaskDto, currentUser: CurrentUserContext) {
    const task = await this.getTaskOrThrow(id);
    this.assertTaskManage(task, currentUser);

    if (task.status !== TaskStatus.PENDING) {
      throw new BadRequestException('仅未开始的任务可改派');
    }

    await this.assertHiredInspector(task.siteId, dto.inspectorId);
    task.inspectorId = dto.inspectorId;
    await this.taskRepo.save(task);
    return this.findOne(id, currentUser);
  }

  private buildDraftEntries(
    snapshot: Array<{ id: string }>,
  ): RecordEntry[] {
    return snapshot.map((entry) => ({
      templateEntryId: entry.id,
      photos: [],
      aiResult: {
        status: CheckResult.PENDING,
        confidence: 0,
        reason: '',
      },
      manualResult: CheckResult.PENDING,
      finalResult: null,
      remark: '',
    }));
  }

  private async resolveDevice(
    siteId: string,
    deviceId?: string,
    serialNumber?: string,
  ): Promise<Device> {
    let device: Device | null = null;
    if (deviceId) {
      device = await this.deviceRepo.findOne({ where: { id: deviceId } });
    } else if (serialNumber?.trim()) {
      device = await this.deviceRepo.findOne({
        where: { serialNumber: serialNumber.trim() },
      });
    }
    if (!device) {
      throw new NotFoundException('设备不存在，请核对序列号或先建档设备');
    }
    if (device.siteId !== siteId) {
      throw new BadRequestException('该设备不属于所选站点/现场');
    }
    return device;
  }

  private async assertHiredInspector(siteId: string, inspectorId: string) {
    const user = await this.userRepo.findOne({ where: { id: inspectorId } });
    if (!user || !userHasRole(user, UserRole.INSPECTOR)) {
      throw new BadRequestException('工程师不存在或角色不正确');
    }
    if (user.status !== CommonStatus.ACTIVE) {
      throw new BadRequestException('工程师已停用');
    }

    const member = await this.memberRepo.findOne({
      where: {
        siteId,
        userId: inspectorId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.INSPECTOR,
      },
    });
    if (member) return;

    // 正站长 / 副站长可兼做本站巡检任务
    const site = await this.siteRepo.findOne({ where: { id: siteId, deletedAt: IsNull() } });
    if (site?.managerId === inspectorId) return;

    const deputy = await this.memberRepo.findOne({
      where: {
        siteId,
        userId: inspectorId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
    });
    if (deputy) return;

    throw new BadRequestException('该工程师未聘用到本站点，无法分配任务');
  }

  private async getTaskOrThrow(id: string) {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在');
    return task;
  }

  private assertSiteAccess(siteId: string, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权操作该站点');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (!currentUser.memberSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权访问该站点');
      }
    }
  }

  private assertTaskAccess(task: InspectionTask, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(task.siteId)) {
        throw new ForbiddenException('无权访问该任务');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (task.inspectorId !== currentUser.id) {
        throw new ForbiddenException('无权访问该任务');
      }
    }
  }

  private assertTaskManage(task: InspectionTask, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(task.siteId)) {
        throw new ForbiddenException('无权管理该任务');
      }
      return;
    }
    throw new ForbiddenException('无权管理任务');
  }

  /** 删除/归档权限：管理员管站内；工程师只能动自己的任务 */
  private assertTaskDelete(task: InspectionTask, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(task.siteId)) {
        throw new ForbiddenException('无权删除该任务');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (task.inspectorId !== currentUser.id && task.createdBy !== currentUser.id) {
        throw new ForbiddenException('只能删除自己的任务');
      }
      return;
    }
    throw new ForbiddenException('无权删除任务');
  }

  private displayStatus(
    status: TaskStatus,
    _recordStatus?: string,
    _hasReject?: boolean,
  ): string {
    // 对外统一三类：未开始 / 进行中 / 已完成（驳回也归进行中）
    if (status === TaskStatus.PENDING) return '未开始';
    if (status === TaskStatus.SUBMITTED || status === TaskStatus.APPROVED) {
      return '已完成';
    }
    if (status === TaskStatus.ARCHIVED) return '已归档';
    if (
      status === TaskStatus.IN_PROGRESS ||
      status === TaskStatus.REJECTED
    ) {
      return '进行中';
    }
    return status;
  }

  private toSafe(task: InspectionTask, recordStatus?: string, hasReject?: boolean) {
    const region = task.site
      ? [task.site.province, task.site.city, task.site.district].filter(Boolean).join('')
      : '';
    return {
      id: task.id,
      siteId: task.siteId,
      deviceId: task.deviceId,
      taskName: task.taskName,
      inspectorId: task.inspectorId,
      createdBy: task.createdBy,
      status: task.status,
      statusLabel: this.displayStatus(task.status, recordStatus, hasReject),
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      aiEnabled: task.aiEnabled,
      createdAt: task.createdAt,
      site: task.site
        ? {
            id: task.site.id,
            name: task.site.name,
            code: task.site.code,
            province: task.site.province,
            city: task.site.city,
            district: task.site.district,
            region,
          }
        : undefined,
      device: task.device
        ? {
            id: task.device.id,
            serialNumber: task.device.serialNumber,
            deviceType: task.device.deviceType,
            model: task.device.model,
          }
        : undefined,
      inspector: task.inspector
        ? {
            id: task.inspector.id,
            realName: task.inspector.realName,
            phone: task.inspector.phone,
          }
        : undefined,
    };
  }
}
