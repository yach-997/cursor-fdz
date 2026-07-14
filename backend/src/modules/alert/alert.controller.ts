import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  OnModuleInit,
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.alertService.resolve(id, user);
  }
}
