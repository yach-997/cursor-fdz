import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { GeocodeService } from './geocode.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums';

/** 地址地理编码 */
@Controller('geocode')
export class GeocodeController {
  constructor(private readonly geocodeService: GeocodeService) {}

  /** 地图配置 */
  @Get('config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  getConfig() {
    return {
      provider: this.geocodeService.isAmapEnabled() ? 'amap' : 'osm',
      geocodeEnabled: this.geocodeService.isAmapEnabled(),
    };
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async geocode(
    @Query('address') address?: string,
    @Query('province') province?: string,
    @Query('city') city?: string,
    @Query('district') district?: string,
    @Query('detail') detail?: string,
    @Query('name') name?: string,
  ) {
    const full =
      address?.trim() ||
      [province, city, district, detail].filter(Boolean).join('');
    if (!full) {
      throw new BadRequestException('请提供 address 或省市区地址');
    }

    const result = await this.geocodeService.geocode({
      address: full,
      province,
      city,
      district,
      detail: detail || address,
      name,
    });

    if (!result) {
      throw new BadRequestException(
        '未找到该地址对应坐标，请尝试填写更完整的地址或站点名称，也可手动在地图上选点',
      );
    }
    return result;
  }

  /** 逆地理编码：坐标 → 省市区地址 */
  @Get('regeo')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async regeo(
    @Query('longitude') longitude?: string,
    @Query('latitude') latitude?: string,
  ) {
    const lng = Number(longitude);
    const lat = Number(latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new BadRequestException('请提供有效的 longitude 和 latitude');
    }
    const result = await this.geocodeService.regeo(lng, lat);
    if (!result) {
      throw new BadRequestException('无法解析该坐标对应的地址');
    }
    return result;
  }
}
