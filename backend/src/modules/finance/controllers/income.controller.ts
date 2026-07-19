import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { IncomeQueryDto } from '../dto/finance.dto';
import { FinanceWorkflowService } from '../services/finance-workflow.service';

@Controller('my')
export class FinanceIncomeController {
  constructor(private readonly workflow: FinanceWorkflowService) {}

  @Get('income')
  @Roles(UserRole.INSPECTOR)
  income(@Query() query: IncomeQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.workflow.myIncome(query.month, user);
  }
}
