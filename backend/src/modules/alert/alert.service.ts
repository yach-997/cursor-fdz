import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AlertConfig,
  AlertRecord,
  AlertType,
  AlertSeverity,
  AlertStatus,
  Site,
  InspectionTask,
  InspectionRecord,
} from '../../entities';
import { UserRole, TaskStatus, RecordStatus, CheckResult, CommonStatus } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import {
  QueryAlertDto,
  UpsertAlertConfigDto,
  QueryAlertConfigDto,
} from './dto/alert.dto';

const DEFAULT_FAIL_THRESHOLD = 25;
const DEFAULT_OVERDUE_DAYS = 3;
const ARCHIVE_MONTHS = 3;

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @InjectRepository(AlertConfig)
    private readonly configRepo: Repository<AlertConfig>,
    @InjectRepository(AlertRecord)
    private readonly alertRepo: Repository<AlertRecord>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
    @InjectRepository(InspectionRecord)
    private readonly recordRepo: Repository<InspectionRecord>,
  ) {}

  async findAll(query: QueryAlertDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const qb = this.alertRepo.createQueryBuilder('a');

    const siteIds = this.scopeSiteIds(query.siteId, currentUser);
    if (currentUser.role === UserRole.SITE_MANAGER && !siteIds.length) {
      return { list: [], total: 0, page, limit };
    }
    if (siteIds.length) {
      qb.andWhere('a.site_id IN (:...siteIds)', { siteIds });
    }
    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }

    qb.orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const total = await qb.getCount();
    const list = await qb.getMany();
    const enriched = await this.enrichAlerts(list);
    return { list: enriched, total, page, limit };
  }

  async getConfigs(query: QueryAlertConfigDto, currentUser: CurrentUserContext) {
    const siteIds = this.scopeSiteIds(query.siteId, currentUser);
    if (currentUser.role === UserRole.SITE_MANAGER && !siteIds.length) {
      return { list: [] };
    }
    const where = siteIds.length ? { siteId: In(siteIds) } : {};
    const configs = await this.configRepo.find({ where: where as any });
    return { list: configs };
  }

  async upsertConfig(dto: UpsertAlertConfigDto, currentUser: CurrentUserContext) {
    this.assertSiteManage(dto.siteId, currentUser);
    let config = await this.configRepo.findOne({ where: { siteId: dto.siteId } });
    if (!config) {
      config = this.configRepo.create({
        siteId: dto.siteId,
        failRateThreshold: dto.failRateThreshold ?? DEFAULT_FAIL_THRESHOLD,
        overdueDays: dto.overdueDays ?? DEFAULT_OVERDUE_DAYS,
        enabled: dto.enabled !== false,
        notifyEmails: dto.notifyEmails ?? null,
        webhookUrl: dto.webhookUrl ?? null,
      });
    } else {
      if (dto.failRateThreshold !== undefined) {
        config.failRateThreshold = dto.failRateThreshold;
      }
      if (dto.overdueDays !== undefined) config.overdueDays = dto.overdueDays;
      if (dto.enabled !== undefined) config.enabled = dto.enabled;
      if (dto.notifyEmails !== undefined) config.notifyEmails = dto.notifyEmails;
      if (dto.webhookUrl !== undefined) config.webhookUrl = dto.webhookUrl;
    }
    return this.configRepo.save(config);
  }

  async resolve(id: string, currentUser: CurrentUserContext) {
    const alert = await this.alertRepo.findOne({ where: { id } });
    if (!alert) throw new NotFoundException('预警不存在');
    this.assertSiteManage(alert.siteId, currentUser);
    alert.status = AlertStatus.RESOLVED;
    alert.resolvedAt = new Date();
    await this.alertRepo.save(alert);
    return alert;
  }

  /** 每小时扫描：不合格率、超期任务、数据归档 */
  @Cron(CronExpression.EVERY_HOUR)
  async runScheduledChecks() {
    this.logger.log('开始执行预警定时扫描');
    await this.archiveOldRecords();
    const sites = await this.siteRepo.find({
      where: { status: CommonStatus.ACTIVE },
    });
    for (const site of sites) {
      await this.checkSiteAlerts(site.id);
    }
  }

  /** 启动后延迟执行一次 */
  async onModuleInitScan() {
    setTimeout(() => void this.runScheduledChecks(), 15000);
  }

  private async checkSiteAlerts(siteId: string) {
    const config = await this.configRepo.findOne({ where: { siteId } });
    if (config && !config.enabled) return;

    const failThreshold = config?.failRateThreshold ?? DEFAULT_FAIL_THRESHOLD;
    const overdueDays = config?.overdueDays ?? DEFAULT_OVERDUE_DAYS;

    await this.checkFailRate(siteId, failThreshold);
    await this.checkOverdueTasks(siteId, overdueDays);
    await this.checkPendingAudit(siteId);
  }

  private async checkFailRate(siteId: string, threshold: number) {
    const tasks = await this.taskRepo.find({ where: { siteId } });
    const taskIds = tasks.map((t) => t.id);
    if (!taskIds.length) return;

    const records = await this.recordRepo
      .createQueryBuilder('r')
      .where('r.task_id IN (:...taskIds)', { taskIds })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [RecordStatus.APPROVED, RecordStatus.SUBMITTED],
      })
      .andWhere('r.created_at >= :since', {
        since: new Date(Date.now() - 30 * 86400000),
      })
      .getMany();

    let total = 0;
    let fail = 0;
    for (const rec of records) {
      for (const e of rec.entries) {
        total += 1;
        if (e.finalResult === CheckResult.FAIL) fail += 1;
      }
    }
    if (!total) return;
    const rate = (fail / total) * 100;
    if (rate >= threshold) {
      await this.createAlertIfNew(siteId, AlertType.HIGH_FAIL_RATE, {
        title: '不合格率偏高',
        message: `近30天条目不合格率 ${rate.toFixed(1)}%，已超过阈值 ${threshold}%`,
        severity: rate >= threshold * 1.5 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        metadata: { failRate: rate, threshold, total, fail },
      });
    }
  }

  private async checkOverdueTasks(siteId: string, overdueDays: number) {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() - overdueDays);

    const overdue = await this.taskRepo
      .createQueryBuilder('t')
      .where('t.site_id = :siteId', { siteId })
      .andWhere('t.status = :status', { status: TaskStatus.PENDING })
      .andWhere('t.planned_date IS NOT NULL')
      .andWhere('t.planned_date < :deadline', { deadline: deadline.toISOString().slice(0, 10) })
      .getCount();

    if (overdue > 0) {
      await this.createAlertIfNew(siteId, AlertType.OVERDUE_TASK, {
        title: '巡检任务超期',
        message: `有 ${overdue} 个待办任务已超过计划日期 ${overdueDays} 天`,
        severity: AlertSeverity.WARNING,
        metadata: { count: overdue, overdueDays },
      });
    }
  }

  private async checkPendingAudit(siteId: string) {
    const tasks = await this.taskRepo.find({
      where: { siteId, status: TaskStatus.SUBMITTED },
    });
    if (!tasks.length) return;
    await this.createAlertIfNew(siteId, AlertType.PENDING_AUDIT, {
      title: '待审核报告积压',
      message: `当前有 ${tasks.length} 份报告等待审核`,
      severity: AlertSeverity.INFO,
      metadata: { count: tasks.length },
    });
  }

  /** 超期 3 个月记录标记 archived */
  private async archiveOldRecords() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - ARCHIVE_MONTHS);

    const oldRecords = await this.recordRepo.find({
      where: {
        status: In([RecordStatus.APPROVED, RecordStatus.REJECTED]),
        createdAt: LessThan(cutoff),
      },
      take: 200,
    });

    if (!oldRecords.length) return;

    for (const rec of oldRecords) {
      rec.status = RecordStatus.ARCHIVED;
    }
    await this.recordRepo.save(oldRecords);
    this.logger.log(`已归档 ${oldRecords.length} 条超期巡检记录`);
  }

  private async createAlertIfNew(
    siteId: string,
    alertType: AlertType,
    payload: {
      title: string;
      message: string;
      severity: AlertSeverity;
      metadata?: Record<string, unknown>;
    },
  ) {
    const since = new Date(Date.now() - 24 * 3600000);
    const exists = await this.alertRepo
      .createQueryBuilder('a')
      .where('a.site_id = :siteId', { siteId })
      .andWhere('a.alert_type = :alertType', { alertType })
      .andWhere('a.status = :status', { status: AlertStatus.OPEN })
      .andWhere('a.created_at >= :since', { since })
      .getOne();
    if (exists) return;

    const alert = this.alertRepo.create({
      siteId,
      alertType,
      title: payload.title,
      message: payload.message,
      severity: payload.severity,
      metadata: payload.metadata || null,
      status: AlertStatus.OPEN,
    });
    const saved = await this.alertRepo.save(alert);
    await this.sendNotifications(siteId, saved);
  }

  /** 通过 Webhook / 邮件列表发送预警通知（邮件仅记录日志，需配置 SMTP 后扩展） */
  private async sendNotifications(siteId: string, alert: AlertRecord) {
    const config = await this.configRepo.findOne({ where: { siteId } });
    if (!config) return;

    const payload = {
      siteId,
      alertType: alert.alertType,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      createdAt: alert.createdAt,
    };

    if (config.webhookUrl) {
      try {
        const res = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          this.logger.warn(`Webhook 通知失败 HTTP ${res.status}: ${config.webhookUrl}`);
        }
      } catch (err) {
        this.logger.warn(`Webhook 通知异常: ${(err as Error).message}`);
      }
    }

    if (config.notifyEmails?.length) {
      this.logger.log(
        `预警邮件待发送 → ${config.notifyEmails.join(', ')} | ${alert.title}: ${alert.message}`,
      );
    }
  }

  private async enrichAlerts(list: AlertRecord[]) {
    if (!list.length) return [];
    const siteIds = [...new Set(list.map((a) => a.siteId))];
    const sites = await this.siteRepo.findBy({ id: In(siteIds) });
    const siteMap = new Map(sites.map((s) => [s.id, s.name]));
    return list.map((a) => ({
      ...a,
      siteName: siteMap.get(a.siteId) || '',
    }));
  }

  private scopeSiteIds(siteId: string | undefined, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      return siteId ? [siteId] : [];
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (siteId) {
        if (!currentUser.managedSiteIds.includes(siteId)) {
          throw new ForbiddenException('无权访问该站点');
        }
        return [siteId];
      }
      return currentUser.managedSiteIds;
    }
    throw new ForbiddenException('无权访问预警');
  }

  private assertSiteManage(siteId: string, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权操作该站点');
      }
      return;
    }
    throw new ForbiddenException('无权操作');
  }
}
