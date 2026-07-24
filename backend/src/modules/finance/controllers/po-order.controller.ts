import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { MatchPoDto, PoOrderQueryDto } from '../dto/finance.dto';
import { FinanceQueryService } from '../services/finance-query.service';

@Controller('po-orders')
export class FinancePoController {
  constructor(private readonly service: FinanceQueryService) {}
  @Get() @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) list(
    @Query() query: PoOrderQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.listPo(query, user);
  }
  @Delete('clear') @Roles(UserRole.SUPER_ADMIN) clear(@CurrentUser() user: CurrentUserContext) {
    return this.service.clearPoOrders(user);
  }
  @Post('generate-cases') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) generateCases(
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.generateCasesFromPo(user);
  }
  @Post(':id/match') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) match(
    @Param('id') id: string,
    @Body() dto: MatchPoDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.matchPo(id, dto.gspCaseNo, user);
  }
  @Post(':id/recalc') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) recalc(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.recalculatePo(id, user);
  }
}
