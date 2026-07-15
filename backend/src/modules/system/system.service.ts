import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InspectionRecord } from '../../entities';
import { CheckResult } from '../../common/enums';
import { VisionService } from '../ai/vision.service';
import { RedisService } from '../redis/redis.service';
import { MinioService } from '../upload/minio.service';
import { QiniuService } from '../upload/qiniu.service';

@Injectable()
export class SystemService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly vision: VisionService,
    private readonly redis: RedisService,
    private readonly qiniu: QiniuService,
    private readonly minio: MinioService,
    @InjectRepository(InspectionRecord)
    private readonly recordRepo: Repository<InspectionRecord>,
  ) {}

  async getStatus() {
    const checkedAt = new Date();
    const database = await this.checkDatabase();
    const aiFailures24h = await this.countAiFailures24h();
    const storageReady = this.qiniu.isEnabled() || this.minio.isConfigured();
    const serverless = Boolean(process.env.VERCEL || process.env.SERVERLESS === 'true');
    const schedulerReady = !serverless || Boolean((process.env.CRON_SECRET || '').trim());

    const services = [
      { key: 'api', name: '核心接口服务', status: 'healthy', detail: '接口响应正常' },
      database,
      {
        key: 'storage',
        name: '云存储',
        status: storageReady ? 'healthy' : 'warning',
        detail: this.qiniu.isEnabled()
          ? '七牛云对象存储已配置'
          : this.minio.isConfigured()
            ? '备用对象存储已配置'
            : '未检测到可用对象存储配置',
      },
      {
        key: 'ai',
        name: 'AI 图像判断',
        status: this.vision.isEnabled() ? (aiFailures24h >= 3 ? 'warning' : 'healthy') : 'warning',
        detail: this.vision.isEnabled()
          ? `模型已配置，近24小时失败条目 ${aiFailures24h} 个`
          : '模型密钥未配置，结果将转人工判断',
      },
      {
        key: 'queue',
        name: '异步任务处理',
        status: serverless || this.redis.isReady ? 'healthy' : 'warning',
        detail: serverless
          ? '云函数后台处理模式'
          : this.redis.isReady
            ? '任务队列连接正常'
            : '任务队列未连接，使用进程内备用队列',
      },
      {
        key: 'scheduler',
        name: '定时预警扫描',
        status: schedulerReady ? 'healthy' : 'warning',
        detail: schedulerReady
          ? '每小时自动检查合格率、超期任务和 AI 异常'
          : '请配置定时任务密钥以启用云端定时扫描',
      },
    ];

    return {
      overall: services.some((item) => item.status === 'error')
        ? 'error'
        : services.some((item) => item.status === 'warning')
          ? 'warning'
          : 'healthy',
      checkedAt: checkedAt.toISOString(),
      services,
      metrics: {
        aiFailures24h,
        dataRetentionMonths: 3,
        monitoring: '7×24小时',
      },
      support: {
        servicePeriod: '系统上线后1年',
        workdayResponseHours: 4,
        holidayMajorResponseHours: 8,
        scope: [
          '系统故障排查与修复',
          'AI 判断异常处理',
          '预警误报核查',
          '用户权限调整',
          '数据异常处理',
        ],
      },
    };
  }

  private async checkDatabase() {
    const started = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return {
        key: 'database',
        name: '数据库',
        status: 'healthy',
        detail: `连接正常，响应 ${Date.now() - started}ms`,
      };
    } catch {
      return { key: 'database', name: '数据库', status: 'error', detail: '数据库连接失败' };
    }
  }

  private async countAiFailures24h() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const records = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.created_at >= :since', { since })
      .orderBy('record.created_at', 'DESC')
      .take(300)
      .getMany();
    return records.reduce(
      (total, record) =>
        total +
        (record.entries || []).filter((entry) => entry.aiResult?.status === CheckResult.ERROR)
          .length,
      0,
    );
  }
}
