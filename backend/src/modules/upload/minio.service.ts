import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

/** MinIO 对象存储封装 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client;
  private bucket: string;
  private publicBase: string;

  constructor(private readonly config: ConfigService) {
    const endPoint = this.config.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = Number(this.config.get('MINIO_PORT', 9000));
    const useSSL = this.config.get<string>('MINIO_USE_SSL', 'false') === 'true';
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'inspection');
    this.client = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey: this.config.get<string>('MINIO_ROOT_USER', 'minioadmin'),
      secretKey: this.config.get<string>('MINIO_ROOT_PASSWORD', 'minioadmin123'),
    });
    const scheme = useSSL ? 'https' : 'http';
    this.publicBase = `${scheme}://${endPoint}:${port}/${this.bucket}`;
  }

  async onModuleInit() {
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
    await this.client.putObject(this.bucket, objectName, buffer, buffer.length, {
      'Content-Type': contentType,
    });
    return `${this.publicBase}/${objectName}`;
  }
}
