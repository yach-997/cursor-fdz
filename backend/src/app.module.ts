import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  User,
  Site,
  SiteMember,
  Device,
  InspectionTemplate,
  InspectionTask,
  InspectionRecord,
  AlertConfig,
  AlertRecord,
  ServiceCase,
  PoOrder,
  PoItem,
  PriceLibrary,
  CasePerformance,
  ImportBatch,
  ChangeLog,
  ItemPriceMapping,
    CaseWorkRecord,
    Assessment,
    MonthlySettlement,
} from './entities';
import { AuthModule } from './modules/auth/auth.module';
import { SiteModule } from './modules/site/site.module';
import { UserModule } from './modules/user/user.module';
import { DeviceModule } from './modules/device/device.module';
import { TemplateModule } from './modules/template/template.module';
import { TaskModule } from './modules/task/task.module';
import { UploadModule } from './modules/upload/upload.module';
import { RecordModule } from './modules/record/record.module';
import { RedisModule } from './modules/redis/redis.module';
import { AiModule } from './modules/ai/ai.module';
import { StatsModule } from './modules/stats/stats.module';
import { AlertModule } from './modules/alert/alert.module';
import { GeocodeModule } from './modules/geocode/geocode.module';
import { SystemModule } from './modules/system/system.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DataScopeGuard } from './common/guards/data-scope.guard';
import { DatabaseSeedService } from './database/seed.service';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = (
          process.env.DATABASE_URL ||
          config.get<string>('DATABASE_URL') ||
          ''
        ).trim();
        const isServerless = Boolean(process.env.VERCEL || process.env.SERVERLESS === 'true');
        if (isServerless && !databaseUrl) {
          throw new Error('Vercel 环境缺少 DATABASE_URL 或该变量值为空');
        }
        const syncFlag = config.get<string>('DB_SYNC', '');
        const synchronize =
          syncFlag === 'true'
            ? true
            : syncFlag === 'false'
              ? false
              : config.get<string>('NODE_ENV') !== 'production';

        const base = {
          type: 'postgres' as const,
          entities: [
            User,
            Site,
            SiteMember,
            Device,
            InspectionTemplate,
            InspectionTask,
            InspectionRecord,
            AlertConfig,
            AlertRecord,
            ServiceCase,
            PoOrder,
            PoItem,
            PriceLibrary,
            CasePerformance,
            ImportBatch,
            ChangeLog,
            ItemPriceMapping,
              CaseWorkRecord,
              Assessment,
              MonthlySettlement,
          ],
          synchronize,
          logging: config.get<string>('NODE_ENV') === 'development',
          ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : undefined,
          extra: {
            max: Number(config.get<string>('DB_POOL_MAX') || (isServerless ? 2 : 10)),
            connectionTimeoutMillis: 10_000,
          },
        };

        if (databaseUrl) {
          return { ...base, url: databaseUrl };
        }

        return {
          ...base,
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          username: config.get<string>('DB_USERNAME', 'inspection'),
          password: config.get<string>('DB_PASSWORD', 'inspection123'),
          database: config.get<string>('DB_DATABASE', 'inspection_db'),
        };
      },
    }),
    TypeOrmModule.forFeature([User, InspectionTemplate]),
    RedisModule,
    AuthModule,
    SiteModule,
    UserModule,
    DeviceModule,
    TemplateModule,
    TaskModule,
    UploadModule,
    RecordModule,
    AiModule,
    StatsModule,
    AlertModule,
    GeocodeModule,
    SystemModule,
    FinanceModule,
  ],
  controllers: [HealthController],
  providers: [
    DatabaseSeedService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: DataScopeGuard },
  ],
})
export class AppModule {}
