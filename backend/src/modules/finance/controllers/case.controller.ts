import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { AssignCaseDto, ClearConfirmQueryDto, FinanceCaseQueryDto, SaveCaseWorkDto } from '../dto/finance.dto';
import { FinanceQueryService } from '../services/finance-query.service';
import { FinanceWorkflowService } from '../services/finance-workflow.service';
import { UploadService } from '../../upload/upload.service';

@Controller('cases')
export class FinanceCaseController {
  constructor(
    private readonly service: FinanceQueryService,
    private readonly workflow: FinanceWorkflowService,
    private readonly upload: UploadService,
  ) {}
  @Get() @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) list(
    @Query() query: FinanceCaseQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.listCases(query, user);
  }
  @Delete('clear') @Roles(UserRole.SUPER_ADMIN) clear(
    @Query() query: ClearConfirmQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.clearCases(user, query.confirm);
  }
  @Get('my/list') @Roles(UserRole.INSPECTOR) myList(@CurrentUser() user: CurrentUserContext) {
    return this.workflow.myCases(user);
  }
  @Get('my/:id') @Roles(UserRole.INSPECTOR) myDetail(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.myCase(id, user);
  }
  @Get(':id/inspectors') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) inspectors(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.availableInspectors(id, user);
  }
  @Post(':id/assign') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) assign(
    @Param('id') id: string,
    @Body() dto: AssignCaseDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.assign(id, dto.inspectorId, dto.reason, user);
  }
  @Post(':id/start') @Roles(UserRole.INSPECTOR) start(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.start(id, user);
  }
  @Put(':id/work-record') @Roles(UserRole.INSPECTOR) saveWork(
    @Param('id') id: string,
    @Body() dto: SaveCaseWorkDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.saveWork(id, dto, user);
  }
  @Post(':id/work-photo')
  @Roles(UserRole.INSPECTOR)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  async workPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserContext,
  ) {
    await this.workflow.myCase(id, user);
    return this.upload.uploadFinanceImage(file);
  }
  @Post(':id/finish') @Roles(UserRole.INSPECTOR) finish(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.finish(id, user);
  }
  @Get(':id') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) detail(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.caseDetail(id, user);
  }
}
