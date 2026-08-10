import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { DashboardQueryDto } from '../dto/finance.dto';
import { FinanceQueryService } from '../services/finance-query.service';

@Controller('finance')
export class FinanceDashboardController {
  constructor(private readonly service: FinanceQueryService) {}

  @Get('dashboard')
  @Roles(UserRole.SUPER_ADMIN)
  dashboard(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.dashboard(query, user);
  }

  @Get('dashboard/variance')
  @Roles(UserRole.SUPER_ADMIN)
  variance(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.dashboardVariance(query, user);
  }
}
