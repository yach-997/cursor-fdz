import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

/** MinIO 对象存储封装 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client;
  private bucket: string;
  private publicBase: string;
  private configured: boolean;

  constructor(private readonly config: ConfigService) {
    const endPoint = this.config.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = Number(this.config.get('MINIO_PORT', 9000));
    const useSSL = this.config.get<string>('MINIO_USE_SSL', 'false') === 'true';
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const accessKey =
      (this.config.get<string>('MINIO_ROOT_USER') || '').trim() ||
      (production ? '' : 'minioadmin');
    const secretKey =
      (this.config.get<string>('MINIO_ROOT_PASSWORD') || '').trim() ||
      (production ? '' : 'minioadmin123');
    this.configured = Boolean(accessKey && secretKey);
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'inspection');
    this.client = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey: accessKey || 'storage-disabled',
      secretKey: secretKey || 'storage-disabled-not-configured',
    });
    const scheme = useSSL ? 'https' : 'http';
    this.publicBase = `${scheme}://${endPoint}:${port}/${this.bucket}`;
  }

  async onModuleInit() {
    if (process.env.VERCEL || process.env.SERVERLESS === 'true') {
      this.logger.log('Serverless 模式：跳过 MinIO 初始化');
      return;
    }
    if (!this.configured) {
      this.logger.warn('生产环境未配置 MinIO 凭据，MinIO 上传不可用');
      return;
    }
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, '');
        this.logger.log(`已创建 MinIO 桶: ${this.bucket}`);
      }
    } catch (err) {
      this.logger.warn(`MinIO 初始化失败（上传将不可用）: ${(err as Error).message}`);
    }
  }

  /** 上传 Buffer，返回公开访问 URL */
  async putObject(
    objectName: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.configured) {
      throw new ServiceUnavailableException('对象存储未配置');
    }
    await this.client.putObject(this.bucket, objectName, buffer, buffer.length, {
      'Content-Type': contentType,
    });
    return `${this.publicBase}/${objectName}`;
  }
}
