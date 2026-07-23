import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InspectionRecord, InspectionTask } from '../../entities';
import { CheckResult, UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { RedisService } from '../redis/redis.service';
import { RecordService } from '../record/record.service';
import { AnalyzeDto } from './dto/ai.dto';
import { VisionService } from './vision.service';

const QUEUE_KEY = 'ai:analyze:queue';
const RESULT_PREFIX = 'ai:result:';

interface AiJob {
  recordId: string;
  templateEntryId: string;
  photoUrls: string[];
  samplePhotoUrls: string[];
  checkCriteria?: string;
  remark?: string;
  enqueuedAt: string;
}

/** AI 异步分析：入 Redis 队列，后台 worker 调用 SiliconFlow 视觉模型 */
@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);
  private running = false;
  private memoryQueue: AiJob[] = [];
  private memoryResults = new Map<string, unknown>();

  constructor(
    private readonly redis: RedisService,
    private readonly recordService: RecordService,
    private readonly vision: VisionService,
    @InjectRepository(InspectionRecord)
    private readonly recordRepo: Repository<InspectionRecord>,
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
  ) {}

  onModuleInit() {
    if (process.env.VERCEL || process.env.SERVERLESS === 'true') {
      this.logger.log('Serverless 模式：AI 将在请求内同步完成');
      return;
    }
    this.running = true;
    this.logger.log(
      this.vision.isEnabled()
        ? 'AI worker：SiliconFlow 视觉对比已启用'
        : 'AI worker：未配置 VISION_API_KEY，将使用模拟结果',
    );
    void this.workerLoop();
  }

  onModuleDestroy() {
    this.running = false;
  }

  async enqueue(dto: AnalyzeDto, currentUser: CurrentUserContext) {
    const record = await this.recordRepo.findOne({ where: { id: dto.recordId } });
    if (!record) throw new NotFoundException('巡检记录不存在');

    const task = await this.taskRepo.findOne({ where: { id: record.taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    this.assertAccess(task, currentUser);

    if (!task.aiEnabled) {
      throw new BadRequestException('该任务未开启 AI 分析');
    }

    const entry = record.entries.find((e) => e.templateEntryId === dto.templateEntryId);
    if (!entry) throw new BadRequestException('条目不存在');

    const photoUrls = uniqueUrls([
      ...(dto.photoUrls || []),
      dto.photoUrl,
      ...(entry.photos || []),
    ]).slice(0, 6);
    if (!photoUrls.length) {
      throw new BadRequestException('请先上传现场照片再进行 AI 分析');
    }

    const snapshotEntry = (task.templateSnapshot || []).find(
      (item: { id?: string }) => item.id === dto.templateEntryId,
    ) as { name?: string; description?: string } | undefined;
    const checkCriteria = [snapshotEntry?.name, snapshotEntry?.description]
      .filter(Boolean)
      .join('\n')
      .slice(0, 800);

    // 标记 pending
    entry.aiResult = {
      status: CheckResult.PENDING,
      confidence: 0,
      reason: photoUrls.length > 1 ? `分析中（共 ${photoUrls.length} 张）...` : '分析中...',
    };
    await this.recordRepo.save(record);

    // 重新分析时清掉上一轮缓存，否则轮询会立即读到旧的失败结果。
    const resultKey = `${RESULT_PREFIX}${dto.recordId}:${dto.templateEntryId}`;
    if (this.redis.isReady) {
      await this.redis.del(resultKey);
    }
    this.memoryResults.delete(resultKey);

    const job: AiJob = {
      recordId: dto.recordId,
      templateEntryId: dto.templateEntryId,
      photoUrls,
      samplePhotoUrls: dto.samplePhotoUrls || [],
      checkCriteria: checkCriteria || undefined,
      remark: entry.remark || undefined,
      enqueuedAt: new Date().toISOString(),
    };

    if (process.env.VERCEL || process.env.SERVERLESS === 'true') {
      await this.processJob(job);
      return {
        queued: false,
        completed: true,
        recordId: dto.recordId,
        templateEntryId: dto.templateEntryId,
        message: 'AI 分析已完成',
      };
    }

    if (this.redis.isReady) {
      await this.redis.lPush(QUEUE_KEY, JSON.stringify(job));
    } else {
      this.memoryQueue.push(job);
    }

    return {
      queued: true,
      recordId: dto.recordId,
      templateEntryId: dto.templateEntryId,
      message: '已加入 AI 分析队列',
    };
  }

  async getResult(
    templateEntryId: string,
    recordId: string | undefined,
    currentUser: CurrentUserContext,
  ) {
    if (!recordId) throw new BadRequestException('请指定巡检记录');
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) throw new NotFoundException('巡检记录不存在');
    const task = await this.taskRepo.findOne({ where: { id: record.taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    this.assertAccess(task, currentUser);

    const key = `${RESULT_PREFIX}${recordId}:${templateEntryId}`;

    if (this.redis.isReady) {
      const raw = await this.redis.get(key);
      if (raw) return JSON.parse(raw);
    }
    if (this.memoryResults.has(key)) {
      return this.memoryResults.get(key);
    }

    // 回退读库
    if (recordId) {
      const record = await this.recordRepo.findOne({ where: { id: recordId } });
      const entry = record?.entries.find((e) => e.templateEntryId === templateEntryId);
      if (entry) {
        return {
          recordId,
          templateEntryId,
          aiResult: entry.aiResult,
        };
      }
    }

    return { status: 'pending', message: '结果尚未产出' };
  }

  private async workerLoop() {
    this.logger.log('AI 队列 worker 已启动');
    while (this.running) {
      try {
        const job = await this.dequeue();
        if (!job) {
          await this.sleep(800);
          continue;
        }
        await this.processJob(job);
      } catch (err) {
        this.logger.warn(`AI worker 异常: ${(err as Error).message}`);
        await this.sleep(1000);
      }
    }
  }

  private async dequeue(): Promise<AiJob | null> {
    if (this.redis.isReady) {
      const popped = await this.redis.brPop(QUEUE_KEY, 1);
      if (!popped) return null;
      try {
        return JSON.parse(popped.element) as AiJob;
      } catch {
        return null;
      }
    }
    return this.memoryQueue.shift() || null;
  }

  private async processJob(job: AiJob) {
    const compared = await this.vision.comparePhoto(
      job.photoUrls,
      job.samplePhotoUrls || [],
      job.checkCriteria,
      { remark: job.remark },
    );
    let reason = compared.reason;
    if (compared.status !== CheckResult.ERROR) {
      reason = await this.vision.polishReason(reason, compared.status);
    }
    const aiResult = {
      status: compared.status,
      confidence: compared.confidence,
      reason,
    };

    try {
      await this.recordService.applyAiResult(
        job.recordId,
        job.templateEntryId,
        aiResult,
      );
    } catch (err) {
      this.logger.warn(`回写 AI 结果失败: ${(err as Error).message}`);
    }

    const payload = {
      recordId: job.recordId,
      templateEntryId: job.templateEntryId,
      aiResult,
      provider: compared.provider,
      finishedAt: new Date().toISOString(),
    };
    const key = `${RESULT_PREFIX}${job.recordId}:${job.templateEntryId}`;
    if (this.redis.isReady) {
      await this.redis.setEx(key, 3600, JSON.stringify(payload));
    } else {
      this.memoryResults.set(key, payload);
    }
  }

  private assertAccess(task: InspectionTask, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(task.siteId)) {
        throw new ForbiddenException('无权操作');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (task.inspectorId !== currentUser.id) {
        throw new ForbiddenException('无权操作');
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

function uniqueUrls(urls: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
