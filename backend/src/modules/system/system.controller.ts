import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  getStatus() {
    return this.systemService.getStatus();
  }
}
