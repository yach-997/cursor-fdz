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
} from '@nestjs/common';
import { RecordService } from './record.service';
import {
  CreateRecordDto,
  QueryRecordDto,
  SaveDraftDto,
  RejectRecordDto,
  SubmitRecordDto,
} from './dto/record.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

/** 巡检记录：进度保存 / 提交 / 审核 */
@Controller('records')
export class RecordController {
  constructor(private readonly recordService: RecordService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findAll(@Query() query: QueryRecordDto, @CurrentUser() user: CurrentUserContext) {
    return this.recordService.findAll(query, user);
  }

  /** 设备横向对比（须在 :id 之前） */
  @Get('device/:deviceId/compare')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async compare(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query('record_ids') recordIds: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    const ids = (recordIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.recordService.compare(deviceId, ids, user);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.findOne(id, user);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async create(@Body() dto: CreateRecordDto, @CurrentUser() user: CurrentUserContext) {
    return this.recordService.create(dto, user);
  }

  @Put(':id/draft')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @HttpCode(HttpStatus.OK)
  async saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.saveDraft(id, dto, user);
  }

  @Put(':id/submit')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitRecordDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.submit(id, dto || {}, user);
  }

  @Put(':id/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.approve(id, user);
  }

  @Put(':id/reject')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectRecordDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.reject(id, dto, user);
  }
}
