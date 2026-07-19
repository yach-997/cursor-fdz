import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { CorrectMonthlyDto, MonthlyExportDto, MonthlyQueryDto } from '../dto/finance.dto';
import { FinanceSettlementService } from '../services/finance-settlement.service';

@Controller('monthly-settlements')
@Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
export class FinanceMonthlySettlementController {
  constructor(private readonly service: FinanceSettlementService) {}
  @Get() list(@Query() query: MonthlyQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.listMonthly(query.month, user);
  }
  @Post(':month/correct') correct(@Param('month') month: string, @Body() dto: CorrectMonthlyDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.correct(month, dto, user);
  }
  @Post(':month/lock') lock(@Param('month') month: string, @CurrentUser() user: CurrentUserContext) {
    return this.service.lock(month, user);
  }
  @Get(':month/export') async export(
    @Param('month') month: string,
    @Query() query: MonthlyExportDto,
    @CurrentUser() user: CurrentUserContext,
    @Res() response: Response,
  ) {
    const template = query.template || 'reconcile';
    const buffer = await this.service.export(month, template, user);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="finance-${month}-${template}.xlsx"`);
    response.send(buffer);
  }
}
