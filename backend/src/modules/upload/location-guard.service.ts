import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InspectionTask, Site } from '../../entities';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

export interface LocationProof {
  gps?: string;
  accuracy?: string | number;
  capturedAt?: string;
  photoTakenAt?: string;
}

export interface LocationVerification {
  verified: boolean;
  distanceMeters: number;
  radiusMeters: number;
  accuracyMeters: number;
  checkedAt: string;
  siteName: string;
}

/** 巡检现场围栏：由后端计算距离，前端提示不能替代这里的强制校验。 */
@Injectable()
export class LocationGuardService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
  ) {}

  async assertOnSite(
    taskId: string,
    proof: LocationProof,
    currentUser: CurrentUserContext,
    requireFreshPhoto = false,
  ): Promise<LocationVerification> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException('巡检任务不存在');

    // 管理员可代为处理历史数据；巡检员必须是任务本人且处于现场。
    if (currentUser.role !== UserRole.INSPECTOR) {
      return {
        verified: true,
        distanceMeters: 0,
        radiusMeters: this.defaultRadiusMeters,
        accuracyMeters: 0,
        checkedAt: new Date().toISOString(),
        siteName: '',
      };
    }
    if (task.inspectorId !== currentUser.id) {
      throw new ForbiddenException('只能执行分配给本人的巡检任务');
    }

    const site = await this.siteRepo.findOne({ where: { id: task.siteId } });
    if (!site) throw new BadRequestException('任务站点不存在');
    const siteLat = Number(site.latitude);
    const siteLng = Number(site.longitude);
    if (!this.validCoordinate(siteLat, siteLng) || (siteLat === 0 && siteLng === 0)) {
      throw new BadRequestException('站点尚未设置准确坐标，请联系管理员完善站点定位');
    }

    const current = this.parseGps(proof.gps);
    if (!current) {
      throw new BadRequestException('未获取到现场定位，请允许定位权限后重试');
    }

    const accuracy = Number(proof.accuracy);
    const maxAccuracy = this.maxAccuracyMeters;
    if (!Number.isFinite(accuracy) || accuracy <= 0) {
      throw new BadRequestException('定位精度未知，请重新定位');
    }
    if (accuracy > maxAccuracy) {
      throw new BadRequestException(
        `当前定位精度约 ${Math.round(accuracy)} 米，请到室外开阔处重新定位`,
      );
    }

    this.assertFreshTime(proof.capturedAt, 3 * 60_000, '定位已过期，请重新定位');
    if (requireFreshPhoto) {
      this.assertFreshTime(
        proof.photoTakenAt,
        10 * 60_000,
        '照片不是刚刚现场拍摄，请重新拍照',
      );
    }

    const siteRadius = Number(site.inspectionRadiusMeters);
    const radiusMeters =
      Number.isFinite(siteRadius) && siteRadius >= 50 && siteRadius <= 5000
        ? siteRadius
        : this.defaultRadiusMeters;
    const distance = Math.round(
      this.distanceMeters(current.latitude, current.longitude, siteLat, siteLng),
    );
    const allowedDistance = radiusMeters + Math.min(accuracy, 50);
    if (distance > allowedDistance) {
      throw new ForbiddenException(
        `当前位置距「${site.name}」约 ${distance} 米，超出 ${radiusMeters} 米巡检范围`,
      );
    }

    return {
      verified: true,
      distanceMeters: distance,
      radiusMeters,
      accuracyMeters: Math.round(accuracy),
      checkedAt: new Date().toISOString(),
      siteName: site.name,
    };
  }

  private get defaultRadiusMeters() {
    const configured = Number(this.config.get('INSPECTION_RADIUS_METERS', 500));
    return Number.isFinite(configured) && configured >= 50 ? configured : 500;
  }

  private get maxAccuracyMeters() {
    const configured = Number(this.config.get('INSPECTION_MAX_GPS_ACCURACY', 200));
    return Number.isFinite(configured) && configured >= 30 ? configured : 200;
  }

  private parseGps(input?: string) {
    if (!input) return null;
    const [latText, lngText] = input.split(/[,，\s]+/);
    const latitude = Number(latText);
    const longitude = Number(lngText);
    return this.validCoordinate(latitude, longitude)
      ? { latitude, longitude }
      : null;
  }

  private validCoordinate(latitude: number, longitude: number) {
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    );
  }

  private assertFreshTime(value: string | undefined, maxAgeMs: number, message: string) {
    const timestamp = value ? Date.parse(value) : Number.NaN;
    const age = Date.now() - timestamp;
    if (!Number.isFinite(timestamp) || age < -60_000 || age > maxAgeMs) {
      throw new BadRequestException(message);
    }
  }

  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
    const earthRadius = 6_371_000;
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
