import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import {
  AssessmentQueryDto,
  ClearConfirmQueryDto,
  CreateAssessmentEventDto,
  RankAssessmentDto,
  SaveAssessmentDto,
  SaveAssessmentScoreDto,
  SaveAssessmentScoreRuleDto,
} from '../dto/finance.dto';
import { FinanceSettlementService } from '../services/finance-settlement.service';

@Controller('assessments')
@Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
export class FinanceAssessmentController {
  constructor(private readonly service: FinanceSettlementService) {}

  @Get('event-catalog')
  catalog() {
    return this.service.eventCatalog();
  }

  @Get('score-rule')
  getScoreRule() {
    return this.service.getScoreRule();
  }

  @Post('score-rule')
  @Roles(UserRole.SUPER_ADMIN)
  saveScoreRule(
    @Body() dto: SaveAssessmentScoreRuleDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.saveScoreRule(dto, user);
  }

  @Post('score')
  saveScore(@Body() dto: SaveAssessmentScoreDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.saveAssessmentScore(dto, user);
  }

  @Delete('clear')
  @Roles(UserRole.SUPER_ADMIN)
  clear(@Query() query: ClearConfirmQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.clearAssessments(user, query.confirm);
  }

  @Get('events')
  listEvents(
    @Query('month') month: string,
    @Query('userId') userId: string | undefined,
    @Query('serviceCaseId') serviceCaseId: string | undefined,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.listEvents(month, user, { userId, serviceCaseId });
  }

  @Post('events')
  createEvent(@Body() dto: CreateAssessmentEventDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.createEvent(dto, user);
  }

  @Delete('events/:id')
  deleteEvent(@Param('id') id: string, @CurrentUser() user: CurrentUserContext) {
    return this.service.deleteEvent(id, user);
  }

  @Get()
  list(@Query() query: AssessmentQueryDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.listAssessments(query.month, user, {
      keyword: query.keyword,
      siteId: query.siteId,
      role: query.role,
    });
  }

  @Post()
  save(@Body() dto: SaveAssessmentDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.saveAssessment(dto, user);
  }

  @Post(':month/rank')
  rank(
    @Param('month') month: string,
    @Body() dto: RankAssessmentDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.rank(month, dto, user);
  }
}
