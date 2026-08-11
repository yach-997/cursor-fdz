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
} from '@nestjs/common';
import { RecordService } from './record.service';
import {
  CreateRecordDto,
  QueryRecordDto,
  SaveDraftDto,
  RejectRecordDto,
  SubmitRecordDto,
  ManualEntryResultDto,
} from './dto/record.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { ParsePostgresUuidPipe } from '../../common/pipes/parse-postgres-uuid.pipe';

/** 巡检记录：进度保存 / 提交 / 审核 */
@Controller('records')
export class RecordController {
  constructor(private readonly recordService: RecordService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findAll(@Query() query: QueryRecordDto, @CurrentUser() user: CurrentUserContext) {
    return this.recordService.findAll(query, user);
  }

  /** 按案例聚合列表（须在 :id 之前） */
  @Get('case-groups')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findCaseGroups(
    @Query() query: QueryRecordDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.findCaseGroups(query, user);
  }

  /** 某案例/独立任务下的报告列表（须在 :id 之前） */
  @Get('by-case/:groupKey')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findCaseRecords(
    @Param('groupKey') groupKey: string,
    @Query() query: QueryRecordDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.findCaseRecords(groupKey, query, user);
  }

  /** 设备横向对比（须在 :id 之前） */
  @Get('device/:deviceId/compare')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async compare(
    @Param('deviceId', ParsePostgresUuidPipe) deviceId: string,
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
    @Param('id', ParsePostgresUuidPipe) id: string,
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
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.saveDraft(id, dto, user);
  }

  @Put(':id/submit')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: SubmitRecordDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.submit(id, dto || {}, user);
  }

  @Put(':id/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.approve(id, user);
  }

  @Put(':id/reject')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: RejectRecordDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.reject(id, dto, user);
  }

  /** 网格长/管理员：按检查项人工确认合格或不合格 */
  @Put(':id/entries/:templateEntryId/manual-result')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async setManualResult(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Param('templateEntryId') templateEntryId: string,
    @Body() dto: ManualEntryResultDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.recordService.setManualEntryResult(id, templateEntryId, dto.manualResult, user);
  }
}
