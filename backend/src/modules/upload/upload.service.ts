import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CurrentUserContext } from '../../common/interfaces';
import { MinioService } from './minio.service';
import { QiniuService } from './qiniu.service';
import { UploadPhotoMetaDto } from './dto/upload.dto';
import { UserRole } from '../../common/enums';
import { LocationGuardService } from './location-guard.service';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly minio: MinioService,
    private readonly qiniu: QiniuService,
    private readonly locationGuard: LocationGuardService,
  ) {}

  async uploadPhoto(
    file: Express.Multer.File,
    meta: UploadPhotoMetaDto,
    currentUser: CurrentUserContext,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('未收到图片文件');
    }

    const location =
      currentUser.role === UserRole.INSPECTOR
        ? await this.verifyInspectorLocation(meta, currentUser, true)
        : null;

    const contentType = file.mimetype?.startsWith('image/')
      ? file.mimetype
      : 'image/jpeg';
    const extension = this.imageExtension(contentType);
    const objectName = `photos/${new Date().toISOString().slice(0, 10)}/${uuidv4()}.${extension}`;
    // 现场照片直接写入云存储，不再做水印合成；AI 分析无覆盖的原始画面。
    const url = await this.putStorage(objectName, file.buffer, contentType);

    return {
      url,
      objectName,
      size: file.buffer.length,
      original: true,
      location,
      storage: this.qiniu.isEnabled() ? 'qiniu' : 'minio',
    };
  }

  async checkLocation(
    meta: UploadPhotoMetaDto & { taskId: string },
    currentUser: CurrentUserContext,
  ) {
    return this.locationGuard.assertOnSite(meta.taskId, meta, currentUser, false);
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
          redirect: 'error',
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

  private imageExtension(contentType: string) {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('heic') || contentType.includes('heif')) return 'heic';
    return 'jpg';
  }

  private verifyInspectorLocation(
    meta: UploadPhotoMetaDto,
    currentUser: CurrentUserContext,
    requireFreshPhoto: boolean,
  ) {
    if (!meta.taskId) {
      throw new BadRequestException('现场拍照缺少巡检任务信息');
    }
    return this.locationGuard.assertOnSite(
      meta.taskId,
      meta,
      currentUser,
      requireFreshPhoto,
    );
  }
}
