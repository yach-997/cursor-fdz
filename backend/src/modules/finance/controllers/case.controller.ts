import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import {
  AssignCaseDto,
  BatchAssignCasesToSitesDto,
  BatchCreateTasksFromCasesDto,
  ClearConfirmQueryDto,
  FinanceCaseQueryDto,
  OcrMileageDto,
  ReviewExpenseDto,
  SaveCaseWorkDto,
  SaveExpenseClaimDto,
  SaveTripExpenseDto,
  SetCaseSiteDto,
  SetCaseTaskTypeDto,
  SetCaseWorkPlanDto,
} from '../dto/finance.dto';
import { FinanceQueryService } from '../services/finance-query.service';
import { FinanceWorkflowService } from '../services/finance-workflow.service';
import { FinanceMultiService } from '../services/finance-multi.service';
import { CaseBridgeService } from '../services/case-bridge.service';
import { UploadService } from '../../upload/upload.service';

@Controller('cases')
export class FinanceCaseController {
  constructor(
    private readonly service: FinanceQueryService,
    private readonly workflow: FinanceWorkflowService,
    private readonly multi: FinanceMultiService,
    private readonly bridge: CaseBridgeService,
    private readonly upload: UploadService,
  ) {}
  @Get() @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) list(
    @Query() query: FinanceCaseQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.listCases(query, user);
  }
  @Get('location-options')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  locationOptions(@CurrentUser() user: CurrentUserContext) {
    return this.service.caseLocationOptions(user);
  }
  @Delete('clear') @Roles(UserRole.SUPER_ADMIN) clear(
    @Query() query: ClearConfirmQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.clearCases(user, query.confirm);
  }
  @Delete('clear-test-data') @Roles(UserRole.SUPER_ADMIN) clearTestData(
    @Query() query: ClearConfirmQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.clearTestData(user, query.confirm);
  }
  @Post('assign-sites') @Roles(UserRole.SUPER_ADMIN) assignSites(
    @Body() dto: BatchAssignCasesToSitesDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.bridge.batchAssignSites(dto, user);
  }
  @Post('batch-create-tasks') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) batchTasks(
    @Body() dto: BatchCreateTasksFromCasesDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.bridge.batchCreateTasks(dto, user);
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
  @Get('expenses/pending') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) pendingExpenses(
    @Query('status') status: string | undefined,
    @Query('keyword') keyword: string | undefined,
    @Query('month') month: string | undefined,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.listExpenses(user, { status, keyword, month });
  }
  @Post('expenses/:expenseId/approve') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) approveExpense(
    @Param('expenseId') expenseId: string,
    @Body() dto: ReviewExpenseDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.reviewExpense(expenseId, true, dto.note, user, dto.approvedAmount);
  }
  @Post('expenses/:expenseId/reject') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) rejectExpense(
    @Param('expenseId') expenseId: string,
    @Body() dto: ReviewExpenseDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.reviewExpense(expenseId, false, dto.note, user);
  }
  @Put(':id/site') @Roles(UserRole.SUPER_ADMIN) setSite(
    @Param('id') id: string,
    @Body() dto: SetCaseSiteDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.bridge.setSite(id, dto, user);
  }
  @Put(':id/task-type') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) setTaskType(
    @Param('id') id: string,
    @Body() dto: SetCaseTaskTypeDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.bridge.setTaskType(id, dto, user);
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
    return this.workflow.assignMany(id, dto, user);
  }
  @Post(':id/assignees/:inspectorId/withdraw')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  withdrawAssignee(
    @Param('id') id: string,
    @Param('inspectorId') inspectorId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.withdrawAssignee(id, inspectorId, user);
  }
  @Put(':id/work-plan') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) setWorkPlan(
    @Param('id') id: string,
    @Body() dto: SetCaseWorkPlanDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.setWorkPlan(id, dto, user);
  }
  @Get(':id/units') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR) listUnits(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.listUnits(id, user);
  }
  @Post(':id/units/:unitId/claim') @Roles(UserRole.INSPECTOR) claimUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.claimUnit(id, unitId, user);
  }
  @Post(':id/units/:unitId/complete') @Roles(UserRole.INSPECTOR) completeUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.completeUnit(id, unitId, user);
  }
  /** 按台保存行程报销（可选） */
  @Post(':id/units/:unitId/expense') @Roles(UserRole.INSPECTOR) saveUnitExpense(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body() dto: SaveTripExpenseDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.upsertTripExpense(id, unitId, dto, user);
  }
  /** 识别里程表读数 */
  @Post(':id/units/:unitId/expense/ocr-mileage')
  @Roles(UserRole.INSPECTOR)
  ocrUnitMileage(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body() dto: OcrMileageDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.ocrUnitMileage(id, unitId, dto.imageUrl, dto.kind, user);
  }
  @Post(':id/expenses') @Roles(UserRole.INSPECTOR) saveExpense(
    @Param('id') id: string,
    @Body() dto: SaveExpenseClaimDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.multi.upsertExpense(id, dto, user);
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
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }),
  )
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
