import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as qiniu from 'qiniu';
import { Readable } from 'stream';

/** 七牛云对象存储（华南 z2） */
@Injectable()
export class QiniuService {
  private readonly logger = new Logger(QiniuService.name);
  private readonly enabled: boolean;
  private readonly bucket: string;
  private readonly domain: string;
  private readonly mac: qiniu.auth.digest.Mac | null;
  private readonly config: qiniu.conf.Config;

  constructor(private readonly configService: ConfigService) {
    const accessKey = (this.configService.get<string>('QINIU_ACCESS_KEY') || '').trim();
    const secretKey = (this.configService.get<string>('QINIU_SECRET_KEY') || '').trim();
    this.bucket = (this.configService.get<string>('QINIU_BUCKET') || '').trim();
    const domainRaw = (this.configService.get<string>('QINIU_DOMAIN') || '').trim();
    this.domain = domainRaw.replace(/\/$/, '');
    this.enabled = Boolean(accessKey && secretKey && this.bucket && this.domain);
    this.mac = this.enabled ? new qiniu.auth.digest.Mac(accessKey, secretKey) : null;
    this.config = new qiniu.conf.Config();
    // 默认华南（upload-z2）；可用 QINIU_ZONE=z0|z1|z2|na0|as0
    const zone = (this.configService.get<string>('QINIU_ZONE') || 'z2').toLowerCase();
    const zoneMap: Record<string, qiniu.conf.Zone> = {
      z0: qiniu.zone.Zone_z0,
      z1: qiniu.zone.Zone_z1,
      z2: qiniu.zone.Zone_z2,
      na0: qiniu.zone.Zone_na0,
      as0: qiniu.zone.Zone_as0,
    };
    this.config.zone = zoneMap[zone] || qiniu.zone.Zone_z2;
    if (this.enabled) {
      this.logger.log(`七牛云已启用：bucket=${this.bucket} domain=${this.domain}`);
    } else {
      this.logger.warn('未配置七牛云，上传将回退 MinIO');
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /** 前端直传用短时 token（可选） */
  createUploadToken(key?: string, expiresSec = 3600) {
    if (!this.mac) throw new Error('七牛云未配置');
    const scope = key ? `${this.bucket}:${key}` : this.bucket;
    const options: qiniu.rs.PutPolicyOptions = {
      scope,
      expires: expiresSec,
    };
    const putPolicy = new qiniu.rs.PutPolicy(options);
    return putPolicy.uploadToken(this.mac);
  }

  async putObject(
    objectName: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.mac) throw new Error('七牛云未配置');
    const token = this.createUploadToken(objectName);
    const formUploader = new qiniu.form_up.FormUploader(this.config);
    const putExtra = new qiniu.form_up.PutExtra();
    putExtra.mimeType = contentType;

    await new Promise<void>((resolve, reject) => {
      formUploader.putStream(
        token,
        objectName,
        Readable.from(buffer),
        putExtra,
        (err, body, info) => {
          if (err) return reject(err);
          if (info.statusCode !== 200) {
            return reject(
              new Error(`七牛上传失败: ${info.statusCode} ${JSON.stringify(body)}`),
            );
          }
          resolve();
        },
      );
    });

    return `${this.domain}/${objectName}`;
  }
}
