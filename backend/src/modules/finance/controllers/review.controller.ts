import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import {
  DeductionDto,
  DeductionReviewDto,
  RejectSettlementDto,
  ReviewCommentDto,
  ReviewPendingQueryDto,
} from '../dto/finance.dto';
import { FinanceWorkflowService } from '../services/finance-workflow.service';

@Controller('review')
@Roles(UserRole.SUPER_ADMIN)
export class FinanceReviewController {
  constructor(private readonly workflow: FinanceWorkflowService) {}

  @Get('pending')
  pending(@Query() query: ReviewPendingQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.workflow.pendingReview(user, query);
  }

  @Get(':caseId/amount-breakdown')
  amountBreakdown(
    @Param('caseId') caseId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.amountBreakdown(caseId, user);
  }

  @Post(':caseId/approve')
  approve(
    @Param('caseId') caseId: string,
    @Body() dto: ReviewCommentDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.approve(caseId, dto.comment, user);
  }

  @Post(':caseId/reject')
  reject(
    @Param('caseId') caseId: string,
    @Body() dto: RejectSettlementDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.reject(caseId, dto.reason, user);
  }

  @Post(':caseId/deduction')
  deduction(
    @Param('caseId') caseId: string,
    @Body() dto: DeductionDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.setDeduction(caseId, dto, user);
  }

  @Post(':caseId/deduction/approve')
  @Roles(UserRole.SUPER_ADMIN)
  approveDeduction(
    @Param('caseId') caseId: string,
    @Body() dto: DeductionReviewDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.reviewDeduction(caseId, true, dto.comment, user);
  }

  @Post(':caseId/deduction/reject')
  @Roles(UserRole.SUPER_ADMIN)
  rejectDeduction(
    @Param('caseId') caseId: string,
    @Body() dto: DeductionReviewDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.workflow.reviewDeduction(caseId, false, dto.comment, user);
  }
}
