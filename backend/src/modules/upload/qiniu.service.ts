import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as qiniu from 'qiniu';
import { Client as MinioClient } from 'minio';

/** 七牛云对象存储（华南 z2）；CDN 不可用时走 S3 兼容接口回源 */
@Injectable()
export class QiniuService {
  private readonly logger = new Logger(QiniuService.name);
  private readonly enabled: boolean;
  private readonly bucket: string;
  private readonly domain: string;
  private readonly zone: string;
  private readonly mac: qiniu.auth.digest.Mac | null;
  private readonly config: qiniu.conf.Config;
  private readonly s3: MinioClient | null;

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
    this.zone = (this.configService.get<string>('QINIU_ZONE') || 'z2').toLowerCase();
    const zoneMap: Record<string, qiniu.conf.Zone> = {
      z0: qiniu.zone.Zone_z0,
      z1: qiniu.zone.Zone_z1,
      z2: qiniu.zone.Zone_z2,
      na0: qiniu.zone.Zone_na0,
      as0: qiniu.zone.Zone_as0,
    };
    this.config.zone = zoneMap[this.zone] || qiniu.zone.Zone_z2;
    const s3Endpoint = this.s3EndpointForZone(this.zone);
    this.s3 =
      this.enabled && s3Endpoint
        ? new MinioClient({
            endPoint: s3Endpoint.host,
            port: 443,
            useSSL: true,
            accessKey,
            secretKey,
            region: s3Endpoint.region,
            pathStyle: true,
          })
        : null;
    if (this.enabled) {
      this.logger.log(`七牛云已启用：bucket=${this.bucket} domain=${this.domain}`);
    } else {
      this.logger.warn('未配置七牛云，上传将回退 MinIO');
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /** 从前端保存的七牛 URL 解析 object key；非本空间域名返回 null */
  extractObjectKey(input: string): string | null {
    try {
      const parsed = new URL(input);
      const host = parsed.hostname.toLowerCase();
      const configuredHost = this.domain
        ? new URL(
            this.domain.startsWith('http') ? this.domain : `https://${this.domain}`,
          ).hostname.toLowerCase()
        : '';
      const isQiniuCdn =
        host === configuredHost ||
        host.endsWith('.clouddn.com') ||
        host.endsWith('.qiniucdn.com') ||
        host.endsWith('.qnssl.com') ||
        host.endsWith('.qbox.me');
      if (!isQiniuCdn) return null;
      const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      return key || null;
    } catch {
      return null;
    }
  }

  /** CDN 测试域失效时，通过 S3 兼容接口从源站读对象 */
  async getObjectByUrl(input: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (!this.s3 || !this.bucket) return null;
    const key = this.extractObjectKey(input);
    if (!key) return null;
    try {
      const stream = await this.s3.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (!bytes.length) return null;
      const lower = key.toLowerCase();
      const contentType = lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
      return { bytes, contentType };
    } catch (err) {
      this.logger.warn(`七牛 S3 回源失败 key=${key}: ${(err as Error).message}`);
      return null;
    }
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

    // Vercel Serverless 上 putStream(Readable) 偶发失败，改用 put(Buffer) 更稳。
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error('七牛上传超时，请检查存储区域和网络配置')),
        55_000,
      );
      formUploader.put(token, objectName, buffer, putExtra, (err, body, info) => {
        if (err) return finish(err);
        if (info.statusCode !== 200) {
          return finish(
            new Error(`七牛上传失败: ${info.statusCode} ${JSON.stringify(body)}`),
          );
        }
        finish();
      });
    });

    return `${this.domain}/${objectName}`;
  }

  private s3EndpointForZone(zone: string): { host: string; region: string } | null {
    const map: Record<string, { host: string; region: string }> = {
      z0: { host: 's3.cn-east-1.qiniucs.com', region: 'cn-east-1' },
      z1: { host: 's3.cn-north-1.qiniucs.com', region: 'cn-north-1' },
      z2: { host: 's3.cn-south-1.qiniucs.com', region: 'cn-south-1' },
      na0: { host: 's3.us-north-1.qiniucs.com', region: 'us-north-1' },
      as0: { host: 's3.ap-southeast-1.qiniucs.com', region: 'ap-southeast-1' },
    };
    return map[zone] || map.z2;
  }
}
