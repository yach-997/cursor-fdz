import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import {
  InspectionRecord,
  InspectionTask,
  Device,
  RecordEntry,
  TemplateEntry,
  AuditTrailEvent,
  RecordLocation,
  ServiceCase,
  CaseWorkUnit,
  User,
} from '../../entities';
import {
  UserRole,
  TaskStatus,
  RecordStatus,
  CheckResult,
} from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import {
  CreateRecordDto,
  QueryRecordDto,
  SaveDraftDto,
  RejectRecordDto,
  SubmitRecordDto,
} from './dto/record.dto';
import { LocationGuardService } from '../upload/location-guard.service';
import { AlertService } from '../alert/alert.service';
import { GeocodeService } from '../geocode/geocode.service';

// AI 分析是异步体验，但不能无限等待。超过此时间仍未回写的条目
// 自动转为“AI 异常/待人工判断”，保证报告流程可以闭环。
const AI_PENDING_TIMEOUT_MS = 3 * 60 * 1000;

@Injectable()
export class RecordService {
  private resolvingStalePending = false;

  constructor(
    @InjectRepository(InspectionRecord)
    private readonly recordRepo: Repository<InspectionRecord>,
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(ServiceCase)
    private readonly cases: Repository<ServiceCase>,
    @InjectRepository(CaseWorkUnit)
    private readonly units: Repository<CaseWorkUnit>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly locationGuard: LocationGuardService,
    @Optional()
    private readonly geocodeService?: GeocodeService,
    @Optional()
    private readonly alertService?: AlertService,
  ) {}

  async findAll(query: QueryRecordDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;

    // 先按任务维度过滤出 taskId，避免 join 实体导致 orderBy databaseName 异常
    const taskQb = this.taskRepo.createQueryBuilder('task').select('task.id');

    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.length) {
        return { list: [], total: 0, page, limit };
      }
      taskQb.andWhere('task.site_id IN (:...siteIds)', {
        siteIds: currentUser.managedSiteIds,
      });
    } else if (currentUser.role === UserRole.INSPECTOR) {
      taskQb.andWhere('task.inspector_id = :inspectorId', {
        inspectorId: currentUser.id,
      });
    }

    if (query.siteId) {
      this.assertSiteAccess(query.siteId, currentUser);
      taskQb.andWhere('task.site_id = :siteId', { siteId: query.siteId });
    }
    if (query.deviceId) {
      taskQb.andWhere('task.device_id = :deviceId', { deviceId: query.deviceId });
    }
    if (query.inspectorId && currentUser.role !== UserRole.INSPECTOR) {
      taskQb.andWhere('task.inspector_id = :filterInspector', {
        filterInspector: query.inspectorId,
      });
    }
    if (query.keyword?.trim()) {
      const kw = `%${query.keyword.trim()}%`;
      taskQb.andWhere(
        `(
          task.task_name ILIKE :kw
          OR EXISTS (
            SELECT 1 FROM service_case sc
            WHERE sc.id = task.service_case_id
              AND (sc.gsp_case_no ILIKE :kw OR sc.project_name ILIKE :kw)
          )
        )`,
        { kw },
      );
    }
    if (query.region?.trim()) {
      taskQb.andWhere(
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
    if (query.serialNumber?.trim()) {
      taskQb.andWhere(
        `EXISTS (
          SELECT 1 FROM devices d
          WHERE d.id = task.device_id AND d.serial_number ILIKE :sn
        )`,
        { sn: `%${query.serialNumber.trim()}%` },
      );
    }

    const tasks = await taskQb.getMany();
    const taskIds = tasks.map((t) => t.id);
    if (!taskIds.length) {
      return { list: [], total: 0, page, limit };
    }

    const qb = this.recordRepo
      .createQueryBuilder('record')
      .where('record.task_id IN (:...taskIds)', { taskIds });

    if (query.scope === 'history') {
      qb.andWhere('record.submitted_at IS NOT NULL');
      if (query.status) {
        qb.andWhere('record.status = :status', { status: query.status });
      } else {
        qb.andWhere('record.status IN (:...sts)', {
          sts: [
            RecordStatus.SUBMITTED,
            RecordStatus.APPROVED,
            RecordStatus.REJECTED,
            RecordStatus.ARCHIVED,
          ],
        });
      }
    } else if (query.scope === 'audit') {
      qb.andWhere('record.status = :status', { status: RecordStatus.SUBMITTED });
    } else if (query.status) {
      qb.andWhere('record.status = :status', { status: query.status });
    }

    if (query.startDate) {
      qb.andWhere('record.submitted_at >= :startDate', {
        startDate: `${query.startDate} 00:00:00`,
      });
    }
    if (query.endDate) {
      qb.andWhere('record.submitted_at <= :endDate', {
        endDate: `${query.endDate} 23:59:59`,
      });
    }

    qb.orderBy('record.submitted_at', 'DESC').addOrderBy('record.createdAt', 'DESC');

    if (query.scope === 'audit') {
      const all = await qb.getMany();
      const taskIdsForCache = [...new Set(all.map((r) => r.taskId))];
      const cache = await this.buildMetaCache(
        taskIdsForCache.length
          ? await this.taskRepo.find({ where: { id: In(taskIdsForCache) } })
          : [],
      );
      const details = await Promise.all(
        all.map(async (r) =>
          this.toDetail(await this.resolveStalePending(r), undefined, cache),
        ),
      );
      const pendingAudit = details.filter(
        (r) =>
          r.task?.aiEnabled === false ||
          (r.aiSummary?.fail || 0) > 0 ||
          (r.aiSummary?.error || 0) > 0,
      );
      const total = pendingAudit.length;
      const list = pendingAudit.slice((page - 1) * limit, page * limit);
      return { list, total, page, limit };
    }

    qb.skip((page - 1) * limit).take(limit);
    const total = await qb.getCount();
    const list = await qb.getMany();
    const taskIdsForCache = [...new Set(list.map((r) => r.taskId))];
    const cache = await this.buildMetaCache(
      taskIdsForCache.length
        ? await this.taskRepo.find({ where: { id: In(taskIdsForCache) } })
        : [],
    );
    const enriched = await Promise.all(
      list.map(async (r) =>
        this.toDetail(await this.resolveStalePending(r), undefined, cache),
      ),
    );
    return { list: enriched, total, page, limit };
  }

  /** 按案例（或无案例时按任务）聚合的报告列表 */
  async findCaseGroups(query: QueryRecordDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const details = await this.collectScopedDetails(query, currentUser);
    type GroupAcc = {
      groupKey: string;
      serviceCaseId: string | null;
      gspCaseNo: string | null;
      projectName: string | null;
      unitLabel: string | null;
      assignMode: string | null;
      siteId: string | null;
      recordCount: number;
      pendingCount: number;
      approvedCount: number;
      rejectedCount: number;
      latestSubmittedAt: string | null;
    };
    const map = new Map<string, GroupAcc>();
    for (const d of details) {
      const key = d.groupKey as string;
      let g = map.get(key);
      if (!g) {
        g = {
          groupKey: key,
          serviceCaseId: d.serviceCaseId || null,
          gspCaseNo: d.gspCaseNo || null,
          projectName: d.projectName || d.task?.taskName || null,
          unitLabel: d.unitLabel || null,
          assignMode: d.assignMode || null,
          siteId: d.task?.siteId || null,
          recordCount: 0,
          pendingCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
          latestSubmittedAt: null,
        };
        map.set(key, g);
      }
      g.recordCount += 1;
      if (d.needsAudit) g.pendingCount += 1;
      if (d.status === RecordStatus.APPROVED || d.status === RecordStatus.ARCHIVED) {
        g.approvedCount += 1;
      }
      if (d.status === RecordStatus.REJECTED) g.rejectedCount += 1;
      const submitted = d.submittedAt ? String(d.submittedAt) : null;
      if (
        submitted &&
        (!g.latestSubmittedAt || new Date(submitted) > new Date(g.latestSubmittedAt))
      ) {
        g.latestSubmittedAt = submitted;
      }
    }
    const sorted = [...map.values()].sort((a, b) => {
      const ta = a.latestSubmittedAt ? new Date(a.latestSubmittedAt).getTime() : 0;
      const tb = b.latestSubmittedAt ? new Date(b.latestSubmittedAt).getTime() : 0;
      return tb - ta;
    });
    const total = sorted.length;
    const list = sorted.slice((page - 1) * limit, page * limit);
    return { list, total, page, limit };
  }

  /** 某一案例（或独立任务）下的报告列表 */
  async findCaseRecords(
    groupKey: string,
    query: QueryRecordDto,
    currentUser: CurrentUserContext,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 100;
    const details = await this.collectScopedDetails(
      { ...query, groupKey },
      currentUser,
    );
    const total = details.length;
    const list = details.slice((page - 1) * limit, page * limit);
    return { list, total, page, limit, groupKey };
  }

  /** 按权限与筛选条件收集报告详情（审核 scope 再筛 needsAudit） */
  private async collectScopedDetails(
    query: QueryRecordDto,
    currentUser: CurrentUserContext,
  ) {
    const taskQb = this.taskRepo.createQueryBuilder('task');

    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.length) return [];
      taskQb.andWhere('task.site_id IN (:...siteIds)', {
        siteIds: currentUser.managedSiteIds,
      });
    } else if (currentUser.role === UserRole.INSPECTOR) {
      taskQb.andWhere('task.inspector_id = :inspectorId', {
        inspectorId: currentUser.id,
      });
    }

    if (query.siteId) {
      this.assertSiteAccess(query.siteId, currentUser);
      taskQb.andWhere('task.site_id = :siteId', { siteId: query.siteId });
    }
    if (query.deviceId) {
      taskQb.andWhere('task.device_id = :deviceId', { deviceId: query.deviceId });
    }
    if (query.inspectorId && currentUser.role !== UserRole.INSPECTOR) {
      taskQb.andWhere('task.inspector_id = :filterInspector', {
        filterInspector: query.inspectorId,
      });
    }

    const group = this.parseGroupKey(query.groupKey);
    if (group?.kind === 'case') {
      taskQb.andWhere('task.service_case_id = :caseId', { caseId: group.id });
    } else if (group?.kind === 'task') {
      taskQb.andWhere('task.id = :onlyTaskId', { onlyTaskId: group.id });
    }

    const kw = query.keyword?.trim();
    if (kw) {
      taskQb.andWhere(
        `(
          task.task_name ILIKE :kw
          OR EXISTS (
            SELECT 1 FROM service_case sc
            WHERE sc.id = task.service_case_id
              AND (sc.gsp_case_no ILIKE :kw OR sc.project_name ILIKE :kw)
          )
        )`,
        { kw: `%${kw}%` },
      );
    }
    if (query.region?.trim()) {
      taskQb.andWhere(
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
    if (query.serialNumber?.trim()) {
      taskQb.andWhere(
        `EXISTS (
          SELECT 1 FROM devices d
          WHERE d.id = task.device_id AND d.serial_number ILIKE :sn
        )`,
        { sn: `%${query.serialNumber.trim()}%` },
      );
    }

    const tasks = await taskQb.getMany();
    const taskIds = tasks.map((t) => t.id);
    if (!taskIds.length) return [];

    const qb = this.recordRepo
      .createQueryBuilder('record')
      .where('record.task_id IN (:...taskIds)', { taskIds });

    if (query.scope === 'history') {
      qb.andWhere('record.submitted_at IS NOT NULL');
      if (query.status) {
        qb.andWhere('record.status = :status', { status: query.status });
      } else {
        qb.andWhere('record.status IN (:...sts)', {
          sts: [
            RecordStatus.SUBMITTED,
            RecordStatus.APPROVED,
            RecordStatus.REJECTED,
            RecordStatus.ARCHIVED,
          ],
        });
      }
    } else if (query.scope === 'audit') {
      qb.andWhere('record.status = :status', { status: RecordStatus.SUBMITTED });
    } else if (query.status) {
      qb.andWhere('record.status = :status', { status: query.status });
    }

    if (query.startDate) {
      qb.andWhere('record.submitted_at >= :startDate', {
        startDate: `${query.startDate} 00:00:00`,
      });
    }
    if (query.endDate) {
      qb.andWhere('record.submitted_at <= :endDate', {
        endDate: `${query.endDate} 23:59:59`,
      });
    }

    qb.orderBy('record.submitted_at', 'DESC').addOrderBy('record.createdAt', 'DESC');
    const records = await qb.getMany();
    const cache = await this.buildMetaCache(tasks);
    let details = await Promise.all(
      records.map(async (r) =>
        this.toDetail(
          await this.resolveStalePending(r),
          cache.tasks.get(r.taskId),
          cache,
        ),
      ),
    );

    if (query.scope === 'audit') {
      details = details.filter(
        (r) =>
          r.task?.aiEnabled === false ||
          (r.aiSummary?.fail || 0) > 0 ||
          (r.aiSummary?.error || 0) > 0,
      );
    }

    return details;
  }

  private parseGroupKey(
    groupKey?: string,
  ): { kind: 'case' | 'task'; id: string } | null {
    if (!groupKey?.trim()) return null;
    const raw = groupKey.trim();
    if (raw.startsWith('case-')) {
      const id = raw.slice(5);
      if (!id) return null;
      return { kind: 'case', id };
    }
    if (raw.startsWith('task-')) {
      const id = raw.slice(5);
      if (!id) return null;
      return { kind: 'task', id };
    }
    return null;
  }

  private async buildMetaCache(tasks: InspectionTask[]) {
    const taskMap = new Map(tasks.map((t): [string, InspectionTask] => [t.id, t]));
    const caseIds = [
      ...new Set(
        tasks
          .map((t) => t.serviceCaseId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const unitIds = [
      ...new Set(
        tasks
          .map((t) => t.workUnitId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const inspectorIds = [
      ...new Set(
        tasks
          .map((t) => t.inspectorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const cases: ServiceCase[] = caseIds.length
      ? await this.cases.find({ where: { id: In(caseIds) } })
      : [];
    const units: CaseWorkUnit[] = unitIds.length
      ? await this.units.find({ where: { id: In(unitIds) } })
      : [];
    const users: User[] = inspectorIds.length
      ? await this.users.find({ where: { id: In(inspectorIds) } })
      : [];
    return {
      tasks: taskMap,
      cases: new Map(cases.map((c): [string, ServiceCase] => [c.id, c])),
      units: new Map(units.map((u): [string, CaseWorkUnit] => [u.id, u])),
      users: new Map(users.map((u): [string, User] => [u.id, u])),
    };
  }

  async findOne(id: string, currentUser: CurrentUserContext) {
    const record = await this.getRecordOrThrow(id);
    const task = await this.getTaskOrThrow(record.taskId);
    this.assertTaskAccess(task, currentUser);
    return this.toDetail(await this.resolveStalePending(record), task);
  }

  /** 创建巡检记录（通常由 start 任务触发） */
  async create(dto: CreateRecordDto, currentUser: CurrentUserContext) {
    const task = await this.getTaskOrThrow(dto.taskId);
    this.assertTaskAccess(task, currentUser);

    const existing = await this.recordRepo.findOne({
      where: { taskId: dto.taskId, status: RecordStatus.DRAFT },
    });
    if (existing) return this.toDetail(existing, task);

    const device = await this.deviceRepo.findOne({ where: { id: task.deviceId } });
    if (!device) throw new NotFoundException('设备不存在');

    const entries = this.buildDraftEntries(task.templateSnapshot || []);
    const record = this.recordRepo.create({
      taskId: task.id,
      deviceType: device.deviceType,
      entries,
      status: RecordStatus.DRAFT,
      reportPhotos: null,
      auditTrail: [],
    } as Partial<InspectionRecord>);
    const saved = await this.recordRepo.save(record);

    if (task.status === TaskStatus.PENDING || task.status === TaskStatus.REJECTED) {
      task.status = TaskStatus.IN_PROGRESS;
      task.startedAt = task.startedAt || new Date();
      await this.taskRepo.save(task);
    }

    return this.toDetail(saved, task);
  }

  /** 保存进度：合并条目照片/人工结果/备注 */
  async saveDraft(id: string, dto: SaveDraftDto, currentUser: CurrentUserContext) {
    const record = await this.getRecordOrThrow(id);
    const task = await this.getTaskOrThrow(record.taskId);
    this.assertInspectorWrite(task, currentUser);

    if (
      record.status !== RecordStatus.DRAFT &&
      record.status !== RecordStatus.REJECTED
    ) {
      throw new BadRequestException('当前状态不可保存进度');
    }

    const map = new Map(dto.entries.map((e) => [e.templateEntryId, e]));
    record.entries = record.entries.map((entry) => {
      const patch = map.get(entry.templateEntryId);
      if (!patch) return entry;
      return {
        ...entry,
        photos: patch.photos ?? entry.photos,
        manualResult: (patch.manualResult as RecordEntry['manualResult']) || entry.manualResult,
        finalResult:
          patch.finalResult !== undefined
            ? (patch.finalResult as RecordEntry['finalResult'])
            : entry.finalResult,
        remark: patch.remark !== undefined ? patch.remark : entry.remark,
      };
    });

    const expectedStatus = record.status;
    if (record.status === RecordStatus.REJECTED) {
      record.status = RecordStatus.DRAFT;
      // 保留 rejectReason 供工程师查看；只记追溯，不抹掉驳回信息
      this.pushTrail(record, {
        action: 'reopened',
        at: new Date().toISOString(),
        by: currentUser.id,
        byName: currentUser.realName,
        summary: '驳回后重新打开，开始返工',
      });
    }

    // 只更新草稿字段，并用读取时的状态作为更新条件。手机端快速连续点击时，
    // 较早发出的自动保存可能晚于“提交报告”返回；整实体 save 会把已提交记录
    // 的状态、提交时间和审核链覆盖回草稿。
    const updated = await this.recordRepo.update(
      { id: record.id, status: expectedStatus },
      {
        entries: record.entries,
        status: record.status,
        auditTrail: record.auditTrail,
      },
    );

    const latest = await this.getRecordOrThrow(record.id);
    if (!updated.affected) {
      // 另一请求已经推进状态，保留最新提交结果，不允许晚到草稿回写。
      return this.toDetail(latest, task);
    }
    return this.toDetail(latest, task);
  }

  /**
   * 提交报告：必检项有照片即可。
   * AI 全合格 → 自动通过进历史；有不合格 → 待审（历史也能看）。
   * 驳回后重提写入追溯链。
   */
  async submit(
    id: string,
    dto: SubmitRecordDto,
    currentUser: CurrentUserContext,
  ) {
    const record = await this.getRecordOrThrow(id);
    const task = await this.getTaskOrThrow(record.taskId);
    this.assertInspectorWrite(task, currentUser);

    let locationSummary = '';
    let capturedLocation: RecordLocation | null = null;
    if (currentUser.role === UserRole.INSPECTOR) {
      const verified = await this.locationGuard.assertOnSite(
        task.id,
        {
          gps: dto.gps,
          accuracy: dto.accuracy,
          capturedAt: dto.capturedAt,
          locationStatus: dto.locationStatus,
          locationReasonCode: dto.locationReasonCode,
          locationReason: dto.locationReason,
        },
        currentUser,
        false,
      );
      capturedLocation = {
        status: verified.status,
        latitude: verified.latitude,
        longitude: verified.longitude,
        accuracyMeters: verified.accuracyMeters || undefined,
        capturedAt: verified.capturedAt,
        distanceToSiteMeters: verified.distanceToSiteMeters,
        reasonCode: verified.reasonCode,
        reason: verified.reason,
      };
      if (
        this.geocodeService &&
        verified.latitude != null &&
        verified.longitude != null &&
        (verified.status === 'ok' || verified.status === 'weak')
      ) {
        try {
          const regeo = await this.geocodeService.regeo(
            verified.longitude,
            verified.latitude,
          );
          if (regeo?.displayName) capturedLocation.address = regeo.displayName;
        } catch {
          // 逆地理失败不影响提交
        }
      }
      if (verified.status === 'ok' || verified.status === 'weak') {
        const coord =
          verified.latitude != null && verified.longitude != null
            ? `${verified.latitude.toFixed(6)}, ${verified.longitude.toFixed(6)}`
            : '-';
        const addr = capturedLocation.address ? `，${capturedLocation.address}` : '';
        const dist =
          verified.distanceToSiteMeters != null
            ? `，距归属网格约 ${verified.distanceToSiteMeters} 米`
            : '';
        const weakHint = verified.status === 'weak' ? '（弱定位）' : '';
        locationSummary = `；现场定位${weakHint} ${coord}${addr}${dist}（精度约 ${verified.accuracyMeters} 米）`;
      } else {
        const label = verified.status === 'skipped' ? '工程师跳过定位' : '未能获取定位';
        locationSummary = `；位置异常：${label}${
          verified.reason ? `（${verified.reason}）` : ''
        }`;
      }
    }
    const withLocation = (summary: string) => `${summary}${locationSummary}`;

    if (
      record.status !== RecordStatus.DRAFT &&
      record.status !== RecordStatus.REJECTED
    ) {
      throw new BadRequestException('当前状态不可提交');
    }

    const snapshot = task.templateSnapshot || [];
    const enabledOptional = new Set(dto.enabledOptionalModuleIds || []);
    const requiredIds = new Set(
      snapshot
        .filter((e) => {
          if (e.isOptionalModule) return enabledOptional.has(e.id);
          return e.isRequired !== false;
        })
        .map((e) => e.id),
    );

    for (const tpl of snapshot) {
      if (!requiredIds.has(tpl.id)) continue;
      const entry = record.entries.find((e) => e.templateEntryId === tpl.id);
      if (!entry?.photos?.length) {
        throw new BadRequestException(`「${tpl.name}」未上传照片，无法提交`);
      }
    }
    record.entries = record.entries.map((entry) => {
      if (
        !entry.finalResult &&
        (entry.aiResult?.status === CheckResult.PASS ||
          entry.aiResult?.status === CheckResult.FAIL)
      ) {
        return {
          ...entry,
          finalResult: entry.aiResult.status as CheckResult.PASS | CheckResult.FAIL,
        };
      }
      return entry;
    });

    const isResubmit =
      !!record.submittedAt ||
      (record.auditTrail || []).some((e) =>
        ['submitted', 'resubmitted', 'rejected'].includes(e.action),
      );

    record.submittedAt = new Date();
    const prevReject = record.rejectReason;
    record.rejectReason = null;
    record.reportPhotos = record.entries.flatMap((e) => e.photos || []);
    record.approvedAt = null;
    record.approvedBy = null;
    if (capturedLocation) {
      record.location = capturedLocation;
    }

    const fail = this.hasAiFail(record.entries);
    const pending = this.hasAiPending(record.entries);

    if (task.aiEnabled === false) {
      record.status = RecordStatus.SUBMITTED;
      task.status = TaskStatus.SUBMITTED;
      this.pushTrail(record, {
        action: isResubmit ? 'resubmitted' : 'submitted',
        at: new Date().toISOString(),
        by: currentUser.id,
        byName: currentUser.realName,
        summary: withLocation(
          isResubmit
            ? '驳回后重新提交，等待管理员人工审核'
            : '已提交，该任务未启用 AI，进入人工审核',
        ),
        reason: prevReject?.reason,
        entryIds: prevReject?.entryIds,
      });
    } else if (fail || this.hasAiError(record.entries)) {
      record.status = RecordStatus.SUBMITTED;
      task.status = TaskStatus.SUBMITTED;
      const aiError = this.hasAiError(record.entries);
      this.pushTrail(record, {
        action: isResubmit ? 'resubmitted' : 'submitted',
        at: new Date().toISOString(),
        by: currentUser.id,
        byName: currentUser.realName,
        summary: withLocation(
          aiError
            ? 'AI 判断失败或异常，已转管理员人工审核'
            : isResubmit
              ? '驳回后重新提交：AI 仍有不合格，进入审核'
              : '提交报告：AI 有不合格项，进入审核',
        ),
        reason: prevReject?.reason,
        entryIds: prevReject?.entryIds,
      });
    } else if (pending) {
      record.status = RecordStatus.SUBMITTED;
      task.status = TaskStatus.SUBMITTED;
      this.pushTrail(record, {
        action: isResubmit ? 'resubmitted' : 'submitted',
        at: new Date().toISOString(),
        by: currentUser.id,
        byName: currentUser.realName,
        summary: withLocation(
          isResubmit
            ? '驳回后重新提交，等待 AI 分析完成后分流'
            : '已提交，等待 AI 分析完成后自动分流',
        ),
        reason: prevReject?.reason,
        entryIds: prevReject?.entryIds,
      });
    } else {
      record.status = RecordStatus.APPROVED;
      record.approvedAt = new Date();
      task.status = TaskStatus.APPROVED;
      this.pushTrail(record, {
        action: isResubmit ? 'resubmitted' : 'submitted',
        at: new Date().toISOString(),
        by: currentUser.id,
        byName: currentUser.realName,
        summary: withLocation(isResubmit ? '驳回后重新提交' : '工程师提交报告'),
        reason: prevReject?.reason,
        entryIds: prevReject?.entryIds,
      });
      this.pushTrail(record, {
        action: 'auto_approved',
        at: new Date().toISOString(),
        summary: 'AI 全部合格，自动通过并存入历史',
      });
    }

    task.completedAt = new Date();
    await this.recordRepo.save(record);
    await this.taskRepo.save(task);

    // AI 尚未分析完时由最后一次 AI 回写触发；其余完成态报告立即检查预警。
    if (task.aiEnabled === false || !this.hasAiPending(record.entries)) {
      await this.alertService?.runSiteChecksNow(task.siteId);
    }

    return this.toDetail(record, task);
  }

  async approve(id: string, currentUser: CurrentUserContext) {
    const record = await this.getRecordOrThrow(id);
    const task = await this.getTaskOrThrow(record.taskId);
    this.assertAuditAccess(task, currentUser);

    if (record.status !== RecordStatus.SUBMITTED) {
      throw new BadRequestException('仅已提交报告可审核通过');
    }

    record.status = RecordStatus.APPROVED;
    record.approvedAt = new Date();
    record.approvedBy = currentUser.id;
    record.rejectReason = null;
    this.pushTrail(record, {
      action: 'approved',
      at: new Date().toISOString(),
      by: currentUser.id,
      byName: currentUser.realName,
      summary: '管理员审核通过',
    });
    await this.recordRepo.save(record);

    task.status = TaskStatus.APPROVED;
    await this.taskRepo.save(task);

    return this.toDetail(record, task);
  }

  async reject(id: string, dto: RejectRecordDto, currentUser: CurrentUserContext) {
    const record = await this.getRecordOrThrow(id);
    const task = await this.getTaskOrThrow(record.taskId);
    this.assertAuditAccess(task, currentUser);

    if (record.status !== RecordStatus.SUBMITTED) {
      throw new BadRequestException('仅已提交报告可驳回');
    }

    const entryIds = dto.entryIds?.length ? [...new Set(dto.entryIds)] : undefined;
    record.status = RecordStatus.REJECTED;
    record.rejectReason = {
      reason: dto.reason,
      rejectedAt: new Date(),
      entryIds,
    };
    record.approvedBy = currentUser.id;
    this.pushTrail(record, {
      action: 'rejected',
      at: new Date().toISOString(),
      by: currentUser.id,
      byName: currentUser.realName,
      reason: dto.reason,
      entryIds,
      summary: '管理员驳回，待工程师返工',
    });
    await this.recordRepo.save(record);

    task.status = TaskStatus.REJECTED;
    await this.taskRepo.save(task);

    return this.toDetail(record, task);
  }

  /** 按设备横向对比多条记录 */
  async compare(
    deviceId: string,
    recordIds: string[],
    currentUser: CurrentUserContext,
  ) {
    if (!recordIds?.length) throw new BadRequestException('请指定对比记录');

    const tasks = await this.taskRepo
      .createQueryBuilder('task')
      .where('task.device_id = :deviceId', { deviceId })
      .getMany();
    const taskIds = tasks.map((t) => t.id);
    if (!taskIds.length) return { deviceId, list: [] };

    for (const t of tasks) {
      this.assertTaskAccess(t, currentUser);
    }

    const records = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.task_id IN (:...taskIds)', { taskIds })
      .andWhere('record.id IN (:...ids)', { ids: recordIds })
      .getMany();

    return {
      deviceId,
      list: await Promise.all(records.map((r) => this.toDetail(r))),
    };
  }

  /** AI 结果回写条目（供 AI 模块调用）；已提交且分析齐后自动分流 */
  async applyAiResult(
    recordId: string,
    templateEntryId: string,
    aiResult: RecordEntry['aiResult'],
  ) {
    // 多个检查项会并行完成 AI 分析。必须锁住记录后再读取和合并目标条目，
    // 否则并发请求各自写回整段 JSONB 时，后写入的旧快照会覆盖先完成的结果。
    const applied = await this.recordRepo.manager.transaction(async (manager) => {
      const lockedRepo = manager.getRepository(InspectionRecord);
      const record = await lockedRepo.findOne({
        where: { id: recordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) throw new NotFoundException('巡检记录不存在');

      const before = this.aiSummary(record.entries || []);
      record.entries = (record.entries || []).map((e) => {
        if (e.templateEntryId !== templateEntryId) return e;
        const next = { ...e, aiResult };
        if (
          aiResult.status === CheckResult.PASS ||
          aiResult.status === CheckResult.FAIL
        ) {
          // 人工结论优先：工程师已经确认后，后到的 AI 结果不能覆盖人工判断。
          if (!e.manualResult || e.manualResult === CheckResult.PENDING) {
            next.finalResult = aiResult.status as
              | CheckResult.PASS
              | CheckResult.FAIL;
          }
        }
        return next;
      });
      const after = this.aiSummary(record.entries);
      await lockedRepo.update(record.id, { entries: record.entries });
      return {
        record,
        shouldRoute:
          (before.pending > 0 && after.pending === 0) ||
          (before.pending === 0 &&
            before.error > 0 &&
            after.error === 0),
      };
    });

    const latest = applied.record;

    // 已提交且 AI 全部落定：合格自动通过，不合格留在审核队列
    if (
      applied.shouldRoute &&
      latest.status === RecordStatus.SUBMITTED &&
      !this.hasAiPending(latest.entries)
    ) {
      const task = await this.getTaskOrThrow(latest.taskId);
      let autoApproved = false;
      if (!this.hasAiFail(latest.entries) && !this.hasAiError(latest.entries)) {
        latest.status = RecordStatus.APPROVED;
        latest.approvedAt = new Date();
        autoApproved = true;
        this.pushTrail(latest, {
          action: 'auto_approved',
          at: new Date().toISOString(),
          summary: 'AI 分析完成且全部合格，自动通过',
        });
        task.status = TaskStatus.APPROVED;
      } else {
        this.pushTrail(latest, {
          action: 'submitted',
          at: new Date().toISOString(),
          summary: this.hasAiError(latest.entries)
            ? 'AI 分析异常，已转管理员人工审核'
            : 'AI 分析完成，存在不合格项，待管理员审核',
        });
      }
      const routed = await this.recordRepo.update(
        { id: latest.id, status: RecordStatus.SUBMITTED },
        {
          status: latest.status,
          approvedAt: latest.approvedAt,
          auditTrail: latest.auditTrail,
        },
      );
      if (autoApproved && routed.affected) {
        await this.taskRepo.save(task);
      }
      if (routed.affected) {
        await this.alertService?.runSiteChecksNow(task.siteId);
      }
    }

    return this.getRecordOrThrow(recordId);
  }

  private buildDraftEntries(snapshot: TemplateEntry[]): RecordEntry[] {
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

  private pushTrail(
    record: InspectionRecord,
    event: AuditTrailEvent,
  ) {
    const prev = Array.isArray(record.auditTrail) ? record.auditTrail : [];
    record.auditTrail = [...prev, event];
  }

  private hasAiFail(entries: RecordEntry[]) {
    return entries.some(
      (e) =>
        e.finalResult === CheckResult.FAIL ||
        e.aiResult?.status === CheckResult.FAIL,
    );
  }

  private hasAiPending(entries: RecordEntry[]) {
    return entries.some((e) => {
      const st = e.aiResult?.status;
      return !st || st === CheckResult.PENDING;
    });
  }

  private hasAiError(entries: RecordEntry[]) {
    return entries.some((e) => e.aiResult?.status === CheckResult.ERROR);
  }

  private isStalePendingEntry(entry: RecordEntry, fallbackStartedAt: Date, now = Date.now()) {
    const status = entry.aiResult?.status;
    if (status && status !== CheckResult.PENDING) return false;
    const startedAt = new Date(entry.aiResult?.startedAt || fallbackStartedAt).getTime();
    return Number.isFinite(startedAt) && now - startedAt >= AI_PENDING_TIMEOUT_MS;
  }

  /**
   * 主动清理超时任务，避免必须等用户刷新报告后才从“分析中”转为人工判断。
   * 加入进程内互斥，防止数据库响应较慢时重复扫描同一批记录。
   */
  @Interval('resolve-stale-ai-results', 60 * 1000)
  private async resolveStalePendingInBackground() {
    if (this.resolvingStalePending) return;
    this.resolvingStalePending = true;
    try {
      const deadline = new Date(Date.now() - AI_PENDING_TIMEOUT_MS);
      const records = await this.recordRepo.find({
        where: {
          status: RecordStatus.SUBMITTED,
          submittedAt: LessThanOrEqual(deadline),
        },
        take: 100,
        order: { submittedAt: 'ASC' },
      });
      for (const record of records) {
        if (this.hasAiPending(record.entries || [])) {
          await this.resolveStalePending(record);
        }
      }
    } finally {
      this.resolvingStalePending = false;
    }
  }

  /**
   * 清理异常中断后遗留的 pending。Vercel 实例退出、浏览器断网或上游模型
   * 长时间无响应时，都不能让用户永久停留在“后台分析中”。
   */
  private async resolveStalePending(record: InspectionRecord) {
    if (
      record.status !== RecordStatus.SUBMITTED ||
      !record.submittedAt ||
      !(record.entries || []).some((entry) =>
        this.isStalePendingEntry(entry, record.submittedAt!),
      )
    ) {
      return record;
    }

    // 必须在行锁内重新读取：AI 可能在上面的初步检查之后刚好完成回写。
    // 锁可保证“AI 回写”和“超时转人工”按先后顺序生效，同时避免多个
    // 报告轮询请求重复追加同一条超时追溯记录。
    return this.recordRepo.manager.transaction(async (manager) => {
      const lockedRepo = manager.getRepository(InspectionRecord);
      const latest = await lockedRepo.findOne({
        where: { id: record.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !latest ||
        latest.status !== RecordStatus.SUBMITTED ||
        !latest.submittedAt ||
        !(latest.entries || []).some((entry) =>
          this.isStalePendingEntry(entry, latest.submittedAt!),
        )
      ) {
        return latest || record;
      }

      latest.entries = (latest.entries || []).map((entry) => {
        if (!this.isStalePendingEntry(entry, latest.submittedAt!)) return entry;
        return {
          ...entry,
          aiResult: {
            status: CheckResult.ERROR,
            confidence: 0,
            reason: 'AI 分析超时，已转人工判断',
          },
        };
      });
      this.pushTrail(latest, {
        action: 'submitted',
        at: new Date().toISOString(),
        summary: 'AI 分析等待超时，未完成条目已转人工判断',
      });
      await lockedRepo.update(latest.id, {
        entries: latest.entries,
        auditTrail: latest.auditTrail,
      });
      return latest;
    });
  }

  private aiSummary(entries: RecordEntry[]) {
    let pass = 0;
    let fail = 0;
    let pending = 0;
    let error = 0;
    for (const e of entries) {
      // 此处只统计 AI 原始判断。工程师现场确认保存在 manualResult/finalResult，
      // 不能覆盖 AI 统计，否则后台会出现“详情 5 项 AI 不合格、列表只显示 1 项”的口径冲突。
      const st = e.aiResult?.status;
      if (st === CheckResult.FAIL) fail += 1;
      else if (st === CheckResult.PASS) pass += 1;
      else if (st === CheckResult.ERROR) error += 1;
      else pending += 1;
    }
    return { pass, fail, pending, error };
  }

  private async toDetail(
    record: InspectionRecord,
    task?: InspectionTask,
    cache?: {
      tasks: Map<string, InspectionTask>;
      cases: Map<string, ServiceCase>;
      units: Map<string, CaseWorkUnit>;
      users: Map<string, User>;
    },
  ) {
    const t =
      task ||
      cache?.tasks.get(record.taskId) ||
      (await this.taskRepo.findOne({ where: { id: record.taskId } }));
    const ai = this.aiSummary(record.entries || []);

    let gspCaseNo: string | null = null;
    let projectName: string | null = null;
    let unitLabel: string | null = null;
    let assignMode: string | null = null;
    let workUnit: { id: string; seq: number; title: string | null } | null = null;
    let inspectorName: string | null = null;

    if (t?.serviceCaseId) {
      const sc =
        cache?.cases.get(t.serviceCaseId) ||
        (await this.cases.findOne({ where: { id: t.serviceCaseId } }));
      if (sc) {
        gspCaseNo = sc.gspCaseNo;
        projectName = sc.projectName;
        unitLabel = sc.unitLabel;
        assignMode = sc.assignMode;
      }
    }
    if (t?.workUnitId) {
      const unit =
        cache?.units.get(t.workUnitId) ||
        (await this.units.findOne({ where: { id: t.workUnitId } }));
      if (unit) {
        workUnit = { id: unit.id, seq: unit.seq, title: unit.title };
      }
    }
    if (t?.inspectorId) {
      const inspector =
        cache?.users.get(t.inspectorId) ||
        (await this.users.findOne({ where: { id: t.inspectorId } }));
      inspectorName = inspector?.realName || null;
    }

    const groupKey = t?.serviceCaseId
      ? `case-${t.serviceCaseId}`
      : `task-${record.taskId}`;

    return {
      id: record.id,
      taskId: record.taskId,
      deviceType: record.deviceType,
      entries: record.entries,
      reportPhotos: record.reportPhotos,
      location: record.location || null,
      status: record.status,
      submittedAt: record.submittedAt,
      approvedAt: record.approvedAt,
      approvedBy: record.approvedBy,
      rejectReason: record.rejectReason,
      auditTrail: record.auditTrail || [],
      aiSummary: ai,
      needsAudit:
        record.status === RecordStatus.SUBMITTED &&
        (t?.aiEnabled === false || ai.fail > 0 || ai.error > 0),
      createdAt: record.createdAt,
      groupKey,
      serviceCaseId: t?.serviceCaseId || null,
      gspCaseNo,
      projectName,
      unitLabel,
      assignMode,
      workUnit,
      inspectorName,
      task: t
        ? {
            id: t.id,
            taskName: t.taskName,
            siteId: t.siteId,
            deviceId: t.deviceId,
            inspectorId: t.inspectorId,
            status: t.status,
            templateSnapshot: t.templateSnapshot,
            aiEnabled: t.aiEnabled,
            serviceCaseId: t.serviceCaseId,
            workUnitId: t.workUnitId,
          }
        : undefined,
    };
  }

  private async getRecordOrThrow(id: string) {
    const record = await this.recordRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('巡检记录不存在');
    return record;
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
        throw new ForbiddenException('无权操作该网格');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (!currentUser.memberSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权访问该网格');
      }
    }
  }

  private assertTaskAccess(task: InspectionTask, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(task.siteId)) {
        throw new ForbiddenException('无权访问该记录');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (task.inspectorId !== currentUser.id) {
        throw new ForbiddenException('无权访问该记录');
      }
    }
  }

  private assertInspectorWrite(task: InspectionTask, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(task.siteId)) {
        throw new ForbiddenException('无权操作该记录');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (task.inspectorId !== currentUser.id) {
        throw new ForbiddenException('只能操作自己的巡检记录');
      }
      return;
    }
    throw new ForbiddenException('无权操作');
  }

  private assertAuditAccess(task: InspectionTask, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(task.siteId)) {
        throw new ForbiddenException('无权审核该记录');
      }
      return;
    }
    throw new ForbiddenException('无权审核');
  }
}
