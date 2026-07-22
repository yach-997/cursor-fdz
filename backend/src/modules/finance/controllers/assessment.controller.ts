import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import {
  AssessmentQueryDto,
  CreateAssessmentEventDto,
  SaveAssessmentDto,
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

  @Get('events')
  listEvents(
    @Query('month') month: string,
    @Query('userId') userId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.listEvents(month, userId, user);
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
    return this.service.listAssessments(query.month, user);
  }

  @Post()
  save(@Body() dto: SaveAssessmentDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.saveAssessment(dto, user);
  }

  @Post(':month/rank')
  rank(@Param('month') month: string, @CurrentUser() user: CurrentUserContext) {
    return this.service.rank(month, user);
  }
}
