import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

/** Redis 客户端封装（队列 / 缓存） */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;
  private ready = false;

  constructor(private readonly config: ConfigService) {
    this.client = createClient({
      socket: {
        host: this.config.get<string>('REDIS_HOST', 'localhost'),
        port: Number(this.config.get('REDIS_PORT', 6379)),
      },
    }) as RedisClientType;
    this.client.on('error', (err) => {
      this.logger.warn(`Redis 错误: ${err.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.ready = true;
      this.logger.log('Redis 已连接');
    } catch (err) {
      this.ready = false;
      this.logger.warn(`Redis 连接失败: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (this.ready) {
      await this.client.quit().catch(() => undefined);
    }
  }

  get isReady() {
    return this.ready;
  }

  getClient() {
    return this.client;
  }

  async lPush(key: string, value: string) {
    if (!this.ready) return 0;
    return this.client.lPush(key, value);
  }

  async brPop(key: string, timeoutSec: number) {
    if (!this.ready) return null;
    return this.client.brPop(key, timeoutSec);
  }

  async setEx(key: string, seconds: number, value: string) {
    if (!this.ready) return;
    await this.client.setEx(key, seconds, value);
  }

  async get(key: string) {
    if (!this.ready) return null;
    return this.client.get(key);
  }

  async del(key: string) {
    if (!this.ready) return 0;
    return this.client.del(key);
  }
}
