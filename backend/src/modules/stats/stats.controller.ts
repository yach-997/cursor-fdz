import {
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { StatsService } from './stats.service';
import { DateRangeQueryDto, ExportQueryDto, SiteStatsQueryDto } from './dto/stats.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

/** 统计 / 仪表盘 / 导出 */
@Controller()
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('dashboard/admin')
  @Roles(UserRole.SUPER_ADMIN)
  async adminDashboard(@CurrentUser() user: CurrentUserContext) {
    return this.statsService.getAdminDashboard(user);
  }

  @Get('dashboard/site')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async siteDashboard(
    @Query() query: SiteStatsQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.statsService.getSiteDashboard(query.siteId, user);
  }

  @Get('stats/completion')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async completion(
    @Query() query: DateRangeQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.statsService.getCompletion(query, user);
  }

  @Get('stats/defects')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async defects(
    @Query() query: DateRangeQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.statsService.getDefects(query, user);
  }

  @Get('reports/export')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async export(
    @Query() query: ExportQueryDto,
    @CurrentUser() user: CurrentUserContext,
    @Res() res: Response,
  ) {
    const buffer = await this.statsService.exportRecords(query, user);
    const filename = `inspection-records-${Date.now()}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('stats/inspector/me')
  @Roles(UserRole.INSPECTOR, UserRole.SITE_MANAGER, UserRole.SUPER_ADMIN)
  async inspectorSummary(
    @Query('siteId') siteId: string | undefined,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.statsService.getInspectorSummary(user, siteId);
  }
}
