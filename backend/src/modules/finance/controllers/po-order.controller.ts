import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { ClearConfirmQueryDto, MatchPoDto, PoOrderQueryDto, UpdatePoOrderDto } from '../dto/finance.dto';
import { FinanceQueryService } from '../services/finance-query.service';

@Controller('po-orders')
export class FinancePoController {
  constructor(private readonly service: FinanceQueryService) {}
  @Get() @Roles(UserRole.SUPER_ADMIN) list(
    @Query() query: PoOrderQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.listPo(query, user);
  }
  @Delete('clear') @Roles(UserRole.SUPER_ADMIN) clear(
    @Query() query: ClearConfirmQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.clearPoOrders(user, query.confirm);
  }
  @Post('generate-cases') @Roles(UserRole.SUPER_ADMIN) generateCases(
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.generateCasesFromPo(user);
  }
  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePoOrderDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.updatePo(id, dto, user);
  }
  @Post(':id/match') @Roles(UserRole.SUPER_ADMIN) match(
    @Param('id') id: string,
    @Body() dto: MatchPoDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.matchPo(id, dto.gspCaseNo, user);
  }
  @Post(':id/recalc') @Roles(UserRole.SUPER_ADMIN) recalc(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.recalculatePo(id, user);
  }
}
