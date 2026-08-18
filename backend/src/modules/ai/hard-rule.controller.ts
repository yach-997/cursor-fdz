import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { HardRuleService } from './hard-rule.service';
import { CreateHardRuleDto, UpdateHardRuleDto } from './dto/hard-rule.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

/** AI 硬规则：仅超级管理员可管理 */
@Controller('ai-hard-rules')
export class HardRuleController {
  constructor(private readonly service: HardRuleService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  list() {
    return this.service.list();
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateHardRuleDto, @CurrentUser() user: CurrentUserContext) {
    return this.service.create(dto, user);
  }

  @Get(':code')
  @Roles(UserRole.SUPER_ADMIN)
  detail(@Param('code') code: string) {
    return this.service.findByCode(code);
  }

  @Put(':code')
  @Roles(UserRole.SUPER_ADMIN)
  update(
    @Param('code') code: string,
    @Body() dto: UpdateHardRuleDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.update(code, dto, user);
  }

  @Delete(':code')
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('code') code: string, @CurrentUser() user: CurrentUserContext) {
    return this.service.remove(code, user);
  }

  @Post(':code/reset')
  @Roles(UserRole.SUPER_ADMIN)
  reset(
    @Param('code') code: string,
    @Body() body: { changeNote?: string },
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.resetToDefault(code, body?.changeNote || '恢复内置默认硬规则', user);
  }
}
