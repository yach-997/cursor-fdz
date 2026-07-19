import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  OnModuleInit,
  Headers,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AlertService } from './alert.service';
import {
  QueryAlertDto,
  UpsertAlertConfigDto,
  QueryAlertConfigDto,
} from './dto/alert.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { ParsePostgresUuidPipe } from '../../common/pipes/parse-postgres-uuid.pipe';
import { Public } from '../../common/decorators/public.decorator';

/** 预警中心 API */
@Controller('alerts')
export class AlertController implements OnModuleInit {
  constructor(private readonly alertService: AlertService) {}

  onModuleInit() {
    this.alertService.onModuleInitScan();
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async findAll(@Query() query: QueryAlertDto, @CurrentUser() user: CurrentUserContext) {
    return this.alertService.findAll(query, user);
  }

  @Get('config/list')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async getConfigs(
    @Query() query: QueryAlertConfigDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.alertService.getConfigs(query, user);
  }

  /** Vercel 每日兜底触发；报告完成时另有即时预警检查。 */
  @Public()
  @Get('scheduled/run')
  async runScheduled(@Headers('authorization') authorization?: string) {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('定时任务密钥尚未配置');
    }
    if (secret && authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException('定时任务令牌无效');
    }
    await this.alertService.runScheduledChecks();
    return { ok: true, checkedAt: new Date().toISOString() };
  }

  @Post('config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async upsertConfig(
    @Body() dto: UpsertAlertConfigDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.alertService.upsertConfig(dto, user);
  }

  @Put(':id/resolve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.alertService.resolve(id, user);
  }
}
