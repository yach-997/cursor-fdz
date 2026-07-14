import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

/** 云端健康检查 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { ok: true, service: 'inspection-api' };
  }
}
