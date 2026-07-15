import {
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import ExcelJS from 'exceljs';
import {
  Site,
  Device,
  InspectionTask,
  InspectionRecord,
  User,
} from '../../entities';
import {
  UserRole,
  TaskStatus,
  RecordStatus,
  CheckResult,
} from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { DateRangeQueryDto, ExportQueryDto } from './dto/stats.dto';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
    @InjectRepository(InspectionRecord)
    private readonly recordRepo: Repository<InspectionRecord>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** 管理员全平台仪表盘 */
  async getAdminDashboard(currentUser: CurrentUserContext) {
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('仅超级管理员可访问');
    }
    return this.buildDashboard(undefined, currentUser);
  }

  /** 站长本站仪表盘 */
  async getSiteDashboard(siteId: string | undefined, currentUser: CurrentUserContext) {
    const ids = this.resolveSiteIds(siteId, currentUser);
    if (!ids.length) {
      return this.emptyDashboard();
    }
    return this.buildDashboard(ids.length === 1 ? ids[0] : ids, currentUser);
  }

  /** 任务完成率统计 */
  async getCompletion(query: DateRangeQueryDto, currentUser: CurrentUserContext) {
    const siteIds = this.resolveSiteIds(query.siteId, currentUser);
    const tasks = await this.loadTasks(siteIds, query.startDate, query.endDate, {
      region: query.region,
      deviceType: query.deviceType,
      inspectorId: query.inspectorId,
    });

    const total = tasks.length;
    const completed = tasks.filter(
      (t) => t.status === TaskStatus.APPROVED || t.status === TaskStatus.ARCHIVED,
    ).length;
    const submitted = tasks.filter((t) => t.status === TaskStatus.SUBMITTED).length;
    const inProgress = tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;

    const byDateMap = new Map<string, { total: number; completed: number }>();
    const bySiteMap = new Map<string, { total: number; completed: number }>();
    for (const t of tasks) {
      const key = (t.plannedDate || t.createdAt).toISOString().slice(0, 10);
      const cur = byDateMap.get(key) || { total: 0, completed: 0 };
      cur.total += 1;
      if (t.status === TaskStatus.APPROVED || t.status === TaskStatus.ARCHIVED) {
        cur.completed += 1;
      }
      byDateMap.set(key, cur);

      const siteStat = bySiteMap.get(t.siteId) || { total: 0, completed: 0 };
      siteStat.total += 1;
      if (t.status === TaskStatus.APPROVED || t.status === TaskStatus.ARCHIVED) {
        siteStat.completed += 1;
      }
      bySiteMap.set(t.siteId, siteStat);
    }

    const byDate = [...byDateMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));
    const completionSiteIds = [...bySiteMap.keys()];
    const completionSites = completionSiteIds.length
      ? await this.siteRepo.findBy({ id: In(completionSiteIds) })
      : [];
    const completionSiteNames = new Map(completionSites.map((site) => [site.id, site.name]));
    const bySite = [...bySiteMap.entries()].map(([siteId, value]) => ({
      siteId,
      siteName: completionSiteNames.get(siteId) || siteId.slice(0, 8),
      ...value,
      completionRate: value.total
        ? Number(((value.completed / value.total) * 100).toFixed(1))
        : 0,
    }));

    return {
      totalTasks: total,
      completedTasks: completed,
      submittedTasks: submitted,
      inProgressTasks: inProgress,
      completionRate: total ? Number(((completed / total) * 100).toFixed(1)) : 0,
      byDate,
      bySite,
    };
  }

  /** 缺陷 / 合格率统计 */
  async getDefects(query: DateRangeQueryDto, currentUser: CurrentUserContext) {
    const siteIds = this.resolveSiteIds(query.siteId, currentUser);
    const records = await this.loadRecords(
      siteIds,
      query.startDate,
      query.endDate,
      [RecordStatus.SUBMITTED, RecordStatus.APPROVED, RecordStatus.REJECTED],
      {
        region: query.region,
        deviceType: query.deviceType,
        inspectorId: query.inspectorId,
      },
    );

    let totalEntries = 0;
    let passEntries = 0;
    let failEntries = 0;
    const byDeviceType = new Map<string, { total: number; fail: number }>();
    const byEntryName = new Map<string, number>();
    const byDateMap = new Map<string, { total: number; pass: number; fail: number }>();
    const bySiteMap = new Map<string, { total: number; pass: number; fail: number }>();
    const inspectorMap = new Map<
      string,
      { total: number; pass: number; fail: number }
    >();

    for (const rec of records) {
      const dt = rec.deviceType;
      if (!byDeviceType.has(dt)) byDeviceType.set(dt, { total: 0, fail: 0 });

      const task = await this.taskRepo.findOne({ where: { id: rec.taskId } });
      const snapshot = task?.templateSnapshot || [];
      const nameMap = new Map(snapshot.map((e) => [e.id, e.name]));
      const dateKey = (rec.submittedAt || rec.createdAt).toISOString().slice(0, 10);
      const dateStat = byDateMap.get(dateKey) || { total: 0, pass: 0, fail: 0 };
      const siteStat = task
        ? bySiteMap.get(task.siteId) || { total: 0, pass: 0, fail: 0 }
        : null;

      for (const entry of rec.entries) {
        totalEntries += 1;
        byDeviceType.get(dt)!.total += 1;
        dateStat.total += 1;
        if (siteStat) siteStat.total += 1;
        const final = entry.finalResult;
        if (final === CheckResult.FAIL) {
          failEntries += 1;
          byDeviceType.get(dt)!.fail += 1;
          const name = nameMap.get(entry.templateEntryId) || entry.templateEntryId;
          byEntryName.set(name, (byEntryName.get(name) || 0) + 1);
          dateStat.fail += 1;
          if (siteStat) siteStat.fail += 1;
        } else if (final === CheckResult.PASS) {
          passEntries += 1;
          dateStat.pass += 1;
          if (siteStat) siteStat.pass += 1;
        }

        if (task?.inspectorId && final) {
          const stat = inspectorMap.get(task.inspectorId) || {
            total: 0,
            pass: 0,
            fail: 0,
          };
          stat.total += 1;
          if (final === CheckResult.PASS) stat.pass += 1;
          if (final === CheckResult.FAIL) stat.fail += 1;
          inspectorMap.set(task.inspectorId, stat);
        }
      }
      byDateMap.set(dateKey, dateStat);
      if (task && siteStat) bySiteMap.set(task.siteId, siteStat);
    }

    const defectSiteIds = [...bySiteMap.keys()];
    const defectSites = defectSiteIds.length
      ? await this.siteRepo.findBy({ id: In(defectSiteIds) })
      : [];
    const defectSiteNames = new Map(defectSites.map((site) => [site.id, site.name]));

    const inspectorIds = [...inspectorMap.keys()];
    const users = inspectorIds.length
      ? await this.userRepo.findBy({ id: In(inspectorIds) })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.realName]));

    const inspectorRanking = [...inspectorMap.entries()]
      .map(([id, s]) => ({
        inspectorId: id,
        realName: userMap.get(id) || id.slice(0, 8),
        total: s.total,
        pass: s.pass,
        fail: s.fail,
        passRate: s.total ? Number(((s.pass / s.total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.passRate - a.passRate);

    return {
      totalInspections: records.length,
      totalEntries,
      failCount: failEntries,
      failRate: totalEntries
        ? Number(((failEntries / totalEntries) * 100).toFixed(1))
        : 0,
      passRate: totalEntries
        ? Number(((passEntries / totalEntries) * 100).toFixed(1))
        : 0,
      byDate: [...byDateMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({
          date,
          ...value,
          passRate: value.total ? Number(((value.pass / value.total) * 100).toFixed(1)) : 0,
        })),
      bySite: [...bySiteMap.entries()].map(([siteId, value]) => ({
        siteId,
        siteName: defectSiteNames.get(siteId) || siteId.slice(0, 8),
        ...value,
        passRate: value.total ? Number(((value.pass / value.total) * 100).toFixed(1)) : 0,
      })),
      byDeviceType: [...byDeviceType.entries()].map(([deviceType, v]) => ({
        deviceType,
        total: v.total,
        fail: v.fail,
        failRate: v.total ? Number(((v.fail / v.total) * 100).toFixed(1)) : 0,
      })),
      byEntry: [...byEntryName.entries()]
        .map(([name, count]) => ({ name, failCount: count }))
        .sort((a, b) => b.failCount - a.failCount)
        .slice(0, 10),
      inspectorRanking,
    };
  }

  /** Excel 导出巡检记录 */
  async exportRecords(query: ExportQueryDto, currentUser: CurrentUserContext) {
    const siteIds = this.resolveSiteIds(query.siteId, currentUser);
    const statuses = query.status
      ? [query.status as RecordStatus]
      : [RecordStatus.SUBMITTED, RecordStatus.APPROVED, RecordStatus.REJECTED];

    const records = await this.loadRecords(
      siteIds,
      query.startDate,
      query.endDate,
      statuses,
      {
        region: query.region,
        deviceType: query.deviceType,
        inspectorId: query.inspectorId,
      },
    );

    const rows: Record<string, string | number>[] = [];
    for (const rec of records) {
      const task = await this.taskRepo.findOne({ where: { id: rec.taskId } });
      const site = task
        ? await this.siteRepo.findOne({ where: { id: task.siteId } })
        : null;
      const device = task
        ? await this.deviceRepo.findOne({ where: { id: task.deviceId } })
        : null;
      const inspector = task
        ? await this.userRepo.findOne({ where: { id: task.inspectorId } })
        : null;

      const failCount = rec.entries.filter((e) => e.finalResult === CheckResult.FAIL).length;
      rows.push({
        记录ID: rec.id,
        任务名称: task?.taskName || '',
        站点: site?.name || '',
        设备序列号: device?.serialNumber || '',
        设备类型: rec.deviceType,
        巡检员: inspector?.realName || '',
        状态: rec.status,
        提交时间: rec.submittedAt
          ? new Date(rec.submittedAt).toLocaleString('zh-CN')
          : '',
        审核时间: rec.approvedAt
          ? new Date(rec.approvedAt).toLocaleString('zh-CN')
          : '',
        检查项数: rec.entries.length,
        不合格项: failCount,
      });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('巡检记录');
    const data = rows.length ? rows : [{ 提示: '暂无数据' }];
    const headers = Object.keys(data[0]);
    worksheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.max(12, Math.min(36, header.length * 2 + 4)),
    }));
    worksheet.addRows(data);
    worksheet.getRow(1).font = { bold: true };
    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
  }

  /** 巡检员个人统计（H5 我的页） */
  async getInspectorSummary(
    currentUser: CurrentUserContext,
    siteId?: string,
  ) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const baseQb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.inspector_id = :inspectorId', { inspectorId: currentUser.id });
    if (siteId) {
      baseQb.andWhere('t.site_id = :siteId', { siteId });
    }

    const monthTasks = await baseQb
      .clone()
      .andWhere('t.created_at >= :startOfMonth', { startOfMonth })
      .getMany();

    const completedStatuses = [TaskStatus.APPROVED, TaskStatus.ARCHIVED];
    const monthCompleted = monthTasks.filter((t) =>
      completedStatuses.includes(t.status),
    ).length;

    const recentTasks = await baseQb
      .clone()
      .orderBy('t.createdAt', 'DESC')
      .take(30)
      .getMany();

    const siteIds = [...new Set(recentTasks.map((t) => t.siteId))];
    const deviceIds = [...new Set(recentTasks.map((t) => t.deviceId))];
    const sites = siteIds.length
      ? await this.siteRepo.findBy({ id: In(siteIds) })
      : [];
    const devices = deviceIds.length
      ? await this.deviceRepo.findBy({ id: In(deviceIds) })
      : [];
    const siteMap = new Map(sites.map((s) => [s.id, s.name]));
    const deviceMap = new Map(devices.map((d) => [d.id, d.serialNumber]));

    return {
      month: {
        total: monthTasks.length,
        completed: monthCompleted,
        inProgress: monthTasks.filter((t) => t.status === TaskStatus.IN_PROGRESS)
          .length,
        pending: monthTasks.filter((t) => t.status === TaskStatus.PENDING).length,
        submitted: monthTasks.filter((t) => t.status === TaskStatus.SUBMITTED)
          .length,
        completionRate: monthTasks.length
          ? Number(((monthCompleted / monthTasks.length) * 100).toFixed(1))
          : 0,
      },
      recentTasks: recentTasks.map((t) => ({
        id: t.id,
        taskName: t.taskName,
        status: t.status,
        siteName: siteMap.get(t.siteId) || '',
        deviceSerial: deviceMap.get(t.deviceId) || '',
        plannedDate: t.plannedDate,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
      })),
    };
  }

  private async buildDashboard(
    siteFilter: string | string[] | undefined,
    currentUser: CurrentUserContext,
  ) {
    const siteIds = siteFilter
      ? Array.isArray(siteFilter)
        ? siteFilter
        : [siteFilter]
      : undefined;

    const siteWhere = siteIds?.length ? { id: In(siteIds) } : {};
    const sites = await this.siteRepo.count({ where: siteWhere as any });

    const siteRows = await this.siteRepo.find({
      where: siteWhere as any,
      select: ['id', 'name', 'latitude', 'longitude', 'city', 'province'],
    });
    const siteMarkers = await Promise.all(
      siteRows.map(async (s) => {
        const deviceCount = await this.deviceRepo.count({ where: { siteId: s.id } });
        return {
          id: s.id,
          name: s.name,
          city: s.city,
          province: s.province,
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
          deviceCount,
        };
      }),
    );

    let deviceQb = this.deviceRepo.createQueryBuilder('d');
    if (siteIds?.length) {
      deviceQb = deviceQb.where('d.site_id IN (:...siteIds)', { siteIds });
    }
    const devices = await deviceQb.getCount();

    let taskQb = this.taskRepo.createQueryBuilder('t');
    if (siteIds?.length) {
      taskQb = taskQb.where('t.site_id IN (:...siteIds)', { siteIds });
    }
    const tasks = await taskQb.getMany();

    const taskIds = tasks.map((t) => t.id);
    let records: InspectionRecord[] = [];
    if (taskIds.length) {
      records = await this.recordRepo
        .createQueryBuilder('r')
        .where('r.task_id IN (:...taskIds)', { taskIds })
        .getMany();
    }

    const taskStats = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === TaskStatus.PENDING).length,
      inProgress: tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
      submitted: tasks.filter((t) => t.status === TaskStatus.SUBMITTED).length,
      approved: tasks.filter((t) => t.status === TaskStatus.APPROVED).length,
      rejected: tasks.filter((t) => t.status === TaskStatus.REJECTED).length,
    };

    const pendingRecords = records.filter((r) => r.status === RecordStatus.SUBMITTED);
    const recentPending = await Promise.all(
      pendingRecords.slice(0, 5).map(async (r) => {
        const task = tasks.find((t) => t.id === r.taskId);
        return {
          id: r.id,
          taskName: task?.taskName,
          deviceType: r.deviceType,
          submittedAt: r.submittedAt,
        };
      }),
    );

    // 近 7 天趋势
    const trend: { date: string; created: number; approved: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      trend.push({
        date: key,
        created: tasks.filter((t) => t.createdAt.toISOString().slice(0, 10) === key).length,
        approved: tasks.filter(
          (t) =>
            t.status === TaskStatus.APPROVED &&
            t.completedAt &&
            t.completedAt.toISOString().slice(0, 10) === key,
        ).length,
      });
    }

    return {
      sites,
      siteMarkers,
      devices,
      tasks: taskStats,
      records: {
        total: records.length,
        submitted: records.filter((r) => r.status === RecordStatus.SUBMITTED).length,
        approved: records.filter((r) => r.status === RecordStatus.APPROVED).length,
      },
      pendingAudit: pendingRecords.length,
      recentPending,
      trend,
      scope: currentUser.role,
    };
  }

  private emptyDashboard() {
    return {
      sites: 0,
      siteMarkers: [] as Array<{
        id: string;
        name: string;
        city: string;
        province: string;
        latitude: number;
        longitude: number;
        deviceCount: number;
      }>,
      devices: 0,
      tasks: {
        total: 0,
        pending: 0,
        inProgress: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
      },
      records: { total: 0, submitted: 0, approved: 0 },
      pendingAudit: 0,
      recentPending: [],
      trend: [],
    };
  }

  private resolveSiteIds(
    siteId: string | undefined,
    currentUser: CurrentUserContext,
  ): string[] {
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      return siteId ? [siteId] : [];
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.length) return [];
      if (siteId) {
        if (!currentUser.managedSiteIds.includes(siteId)) {
          throw new ForbiddenException('无权访问该站点');
        }
        return [siteId];
      }
      return currentUser.managedSiteIds;
    }
    throw new ForbiddenException('无权访问统计数据');
  }

  private async loadTasks(
    siteIds: string[],
    startDate?: string,
    endDate?: string,
    extra?: { region?: string; deviceType?: string; inspectorId?: string },
  ) {
    const qb = this.taskRepo.createQueryBuilder('t');
    if (siteIds.length) {
      qb.andWhere('t.site_id IN (:...siteIds)', { siteIds });
    }
    if (startDate) {
      qb.andWhere('t.created_at >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('t.created_at <= :endDate', { endDate: `${endDate} 23:59:59` });
    }
    if (extra?.inspectorId) {
      qb.andWhere('t.inspector_id = :inspectorId', {
        inspectorId: extra.inspectorId,
      });
    }
    if (extra?.region?.trim()) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM sites s WHERE s.id = t.site_id AND (
            s.name ILIKE :region OR s.province ILIKE :region
            OR s.city ILIKE :region OR s.district ILIKE :region
          )
        )`,
        { region: `%${extra.region.trim()}%` },
      );
    }
    if (extra?.deviceType) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM devices d
          WHERE d.id = t.device_id AND d.device_type = :deviceType
        )`,
        { deviceType: extra.deviceType },
      );
    }
    return qb.getMany();
  }

  private async loadRecords(
    siteIds: string[],
    startDate: string | undefined,
    endDate: string | undefined,
    statuses: RecordStatus[],
    extra?: { region?: string; deviceType?: string; inspectorId?: string },
  ) {
    const taskQb = this.taskRepo.createQueryBuilder('t').select('t.id');
    if (siteIds.length) {
      taskQb.andWhere('t.site_id IN (:...siteIds)', { siteIds });
    }
    if (extra?.inspectorId) {
      taskQb.andWhere('t.inspector_id = :inspectorId', {
        inspectorId: extra.inspectorId,
      });
    }
    if (extra?.region?.trim()) {
      taskQb.andWhere(
        `EXISTS (
          SELECT 1 FROM sites s WHERE s.id = t.site_id AND (
            s.name ILIKE :region OR s.province ILIKE :region
            OR s.city ILIKE :region OR s.district ILIKE :region
          )
        )`,
        { region: `%${extra.region.trim()}%` },
      );
    }
    if (extra?.deviceType) {
      taskQb.andWhere(
        `EXISTS (
          SELECT 1 FROM devices d
          WHERE d.id = t.device_id AND d.device_type = :deviceType
        )`,
        { deviceType: extra.deviceType },
      );
    }
    const tasks = await taskQb.getMany();
    const taskIds = tasks.map((t) => t.id);
    if (!taskIds.length) return [];

    const qb = this.recordRepo.createQueryBuilder('r');
    qb.andWhere('r.task_id IN (:...taskIds)', { taskIds });
    if (statuses.length) {
      qb.andWhere('r.status IN (:...statuses)', { statuses });
    }
    if (startDate) {
      qb.andWhere('r.created_at >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('r.created_at <= :endDate', { endDate: `${endDate} 23:59:59` });
    }
    return qb.getMany();
  }
}
