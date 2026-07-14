import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { AiService } from './ai.service';
import { AnalyzeDto } from './dto/ai.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

/** AI 分析接口：入队 + 轮询结果 */
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('analyze')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async analyze(@Body() dto: AnalyzeDto, @CurrentUser() user: CurrentUserContext) {
    return this.aiService.enqueue(dto, user);
  }

  @Get('result/:templateEntryId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async getResult(
    @Param('templateEntryId') templateEntryId: string,
    @Query('recordId') recordId?: string,
  ) {
    return this.aiService.getResult(templateEntryId, recordId);
  }
}
