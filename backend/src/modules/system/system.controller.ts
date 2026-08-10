import { Body, Controller, Get, Put } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums';
import { UpdateBrandingDto } from './dto/branding.dto';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  /** 公开：登录页 / 入口页读取系统名称与 Logo */
  @Public()
  @Get('branding')
  getBranding() {
    return this.systemService.getBranding();
  }

  /** 超级管理员：更新系统名称与 Logo */
  @Put('branding')
  @Roles(UserRole.SUPER_ADMIN)
  updateBranding(@Body() dto: UpdateBrandingDto) {
    return this.systemService.updateBranding(dto);
  }

  @Get('status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  getStatus() {
    return this.systemService.getStatus();
  }
}
