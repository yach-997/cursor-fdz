import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { InspectionTask, Site, Device, User } from '../../entities';
import { CurrentUserContext } from '../../common/interfaces';
import { MinioService } from './minio.service';
import { QiniuService } from './qiniu.service';
import { applyWatermark } from './watermark.util';
import { UploadPhotoMetaDto } from './dto/upload.dto';
import { GeocodeService } from '../geocode/geocode.service';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly minio: MinioService,
    private readonly qiniu: QiniuService,
    private readonly geocode: GeocodeService,
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async uploadPhoto(
    file: Express.Multer.File,
    meta: UploadPhotoMetaDto,
    currentUser: CurrentUserContext,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('未收到图片文件');
    }

    const watermarkMeta = await this.resolveWatermarkMeta(meta, currentUser);
    const stamped = await applyWatermark(file.buffer, watermarkMeta);

    const objectName = `photos/${new Date().toISOString().slice(0, 10)}/${uuidv4()}.jpg`;
    const url = await this.putStorage(objectName, stamped, 'image/jpeg');

    return {
      url,
      objectName,
      size: stamped.length,
      watermark: watermarkMeta,
      storage: this.qiniu.isEnabled() ? 'qiniu' : 'minio',
    };
  }

  async uploadBatch(
    files: Express.Multer.File[],
    meta: UploadPhotoMetaDto,
    currentUser: CurrentUserContext,
  ) {
    if (!files?.length) throw new BadRequestException('未收到图片文件');
    const results: Awaited<ReturnType<UploadService['uploadPhoto']>>[] = [];
    for (const file of files) {
      results.push(await this.uploadPhoto(file, meta, currentUser));
    }
    return { list: results };
  }

  /**
   * 代理读取公开巡检图片，解决 HTTPS 页面无法加载七牛测试域名 HTTP 图片的问题。
   * 仅允许当前配置的七牛域名和 MinIO 地址，避免成为任意 URL 代理。
   */
  async fetchPublicImage(input: string) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new BadRequestException('图片地址无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('仅支持 HTTP(S) 图片地址');
    }

    const allowed = new Set<string>();
    const qiniuDomain = (process.env.QINIU_DOMAIN || '').trim();
    if (qiniuDomain) {
      try {
        allowed.add(new URL(qiniuDomain).host.toLowerCase());
      } catch {
        // 环境变量格式错误时不放行。
      }
    }
    const minioHost = (process.env.MINIO_ENDPOINT || 'localhost').trim();
    const minioPort = (process.env.MINIO_PORT || '9000').trim();
    allowed.add(`${minioHost}:${minioPort}`.toLowerCase());

    if (!allowed.has(parsed.host.toLowerCase())) {
      throw new BadRequestException('该图片域名不允许代理');
    }

    const candidates = [parsed.toString()];
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase().endsWith('.clouddn.com')
    ) {
      const fallback = new URL(parsed.toString());
      fallback.protocol = 'http:';
      candidates.push(fallback.toString());
    }

    let lastError: Error | null = null;
    for (const url of candidates) {
      try {
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          redirect: 'follow',
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const contentType = (resp.headers.get('content-type') || 'image/jpeg')
          .split(';')[0]
          .trim();
        if (!contentType.startsWith('image/')) {
          throw new Error(`响应不是图片: ${contentType}`);
        }
        const bytes = Buffer.from(await resp.arrayBuffer());
        if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
          throw new Error('图片为空或超过 15MB');
        }
        return { bytes, contentType };
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new BadRequestException(`图片读取失败: ${lastError?.message || '未知错误'}`);
  }

  /** 前端直传七牛用 token */
  getQiniuToken() {
    if (!this.qiniu.isEnabled()) {
      throw new BadRequestException('未配置七牛云');
    }
    const token = this.qiniu.createUploadToken();
    return {
      token,
      domain: process.env.QINIU_DOMAIN?.replace(/\/$/, ''),
      uploadUrl: process.env.QINIU_UPLOAD_URL || 'https://upload-z2.qiniup.com',
      bucket: process.env.QINIU_BUCKET,
    };
  }

  private async putStorage(
    objectName: string,
    buffer: Buffer,
    contentType: string,
  ) {
    if (this.qiniu.isEnabled()) {
      try {
        return await this.qiniu.putObject(objectName, buffer, contentType);
      } catch (err) {
        this.logger.warn(`七牛上传失败，回退 MinIO: ${(err as Error).message}`);
      }
    }
    if (process.env.VERCEL || process.env.SERVERLESS === 'true') {
      throw new BadRequestException('Vercel 后端必须正确配置七牛云存储');
    }
    return this.minio.putObject(objectName, buffer, contentType);
  }

  private async resolveWatermarkMeta(
    meta: UploadPhotoMetaDto,
    currentUser: CurrentUserContext,
  ) {
    let serialNumber = meta.serialNumber || '-';
    let siteName = meta.siteName || '-';
    let inspectorName =
      meta.inspectorName || currentUser.realName || currentUser.username;
    let gps = meta.gps;

    if (meta.taskId) {
      const task = await this.taskRepo.findOne({ where: { id: meta.taskId } });
      if (task) {
        const [site, device, inspector] = await Promise.all([
          this.siteRepo.findOne({ where: { id: task.siteId } }),
          this.deviceRepo.findOne({ where: { id: task.deviceId } }),
          this.userRepo.findOne({ where: { id: task.inspectorId } }),
        ]);
        if (site) siteName = site.name;
        if (device) serialNumber = device.serialNumber;
        if (inspector) inspectorName = inspector.realName;
      }
    }

    // GPS 逆地理：写进水印更易读
    if (gps && this.geocode.isAmapEnabled()) {
      const parts = gps.split(/[,，\s]+/).map((x) => Number(x.trim()));
      if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
        // 前端传 lat,lng 或 lng,lat：国内常见 lat,lng
        const [a, b] = parts;
        const lat = Math.abs(a) <= 90 ? a : b;
        const lng = Math.abs(a) <= 90 ? b : a;
        const re = await this.geocode.regeo(lng, lat);
        if (re?.displayName) {
          gps = `${gps} · ${re.displayName}`;
        }
      }
    }

    return {
      timestamp: new Date().toLocaleString('zh-CN', { hour12: false }),
      gps,
      serialNumber,
      inspectorName,
      siteName,
    };
  }
}
