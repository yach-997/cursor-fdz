import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { AssessmentQueryDto, SaveAssessmentDto } from '../dto/finance.dto';
import { FinanceSettlementService } from '../services/finance-settlement.service';

@Controller('assessments')
@Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
export class FinanceAssessmentController {
  constructor(private readonly service: FinanceSettlementService) {}
  @Get() list(@Query() query: AssessmentQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.listAssessments(query.month, user);
  }
  @Post() save(@Body() dto: SaveAssessmentDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.saveAssessment(dto, user);
  }
  @Post(':month/rank') rank(@Param('month') month: string, @CurrentUser() user: CurrentUserContext) {
    return this.service.rank(month, user);
  }
}
