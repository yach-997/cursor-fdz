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
