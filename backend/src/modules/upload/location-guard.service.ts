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
  /** 前端声明：failed / skipped（无定位仍继续作业） */
  locationStatus?: string;
  locationReasonCode?: string;
  locationReason?: string;
}

export type LocationQualityStatus = 'ok' | 'weak' | 'failed' | 'skipped';

/** 现场定位采集结果：软失败不拦截，仅留质量状态 */
export interface LocationCapture {
  verified: boolean;
  status: LocationQualityStatus;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number;
  capturedAt: string;
  checkedAt: string;
  siteName: string;
  distanceToSiteMeters?: number;
  /** 兼容旧前端字段 */
  distanceMeters: number;
  radiusMeters: number;
  reasonCode?: string;
  reason?: string;
}

/** 采集现场 GPS；无信号/精度差时写入异常状态，不阻断作业。 */
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
  ): Promise<LocationCapture> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException('巡检任务不存在');

    // 非工程师（管理员代操作）不强制现场定位
    if (currentUser.role !== UserRole.INSPECTOR) {
      return this.buildCapture({
        status: 'ok',
        latitude: null,
        longitude: null,
        accuracyMeters: 0,
        siteName: '',
        reasonCode: 'admin',
        reason: '管理员代操作，未校验现场定位',
      });
    }
    if (task.inspectorId !== currentUser.id) {
      throw new ForbiddenException('只能执行分配给本人的巡检任务');
    }

    const site = await this.siteRepo.findOne({ where: { id: task.siteId } });
    if (!site) throw new BadRequestException('任务网格不存在');

    const declared =
      proof.locationStatus === 'skipped' || proof.locationStatus === 'failed'
        ? proof.locationStatus
        : null;

    const current = this.parseGps(proof.gps);
    if (!current) {
      const status: LocationQualityStatus = declared === 'skipped' ? 'skipped' : 'failed';
      return this.buildCapture({
        status,
        latitude: null,
        longitude: null,
        accuracyMeters: 0,
        siteName: site.name,
        reasonCode:
          proof.locationReasonCode ||
          (status === 'skipped' ? 'manual_skip' : 'missing'),
        reason:
          proof.locationReason ||
          (status === 'skipped'
            ? '工程师确认无法定位后继续作业'
            : '未获取到现场定位（可能无信号或未授权）'),
      });
    }

    const accuracy = Number(proof.accuracy);
    const maxAccuracy = this.maxAccuracyMeters;
    const accuracyOk = Number.isFinite(accuracy) && accuracy > 0 && accuracy <= maxAccuracy;
    const capturedAt = proof.capturedAt || new Date().toISOString();
    const fresh = this.isFreshTime(capturedAt, 3 * 60_000);
    void requireFreshPhoto;

    const siteLat = Number(site.latitude);
    const siteLng = Number(site.longitude);
    let distanceToSiteMeters: number | undefined;
    if (this.validCoordinate(siteLat, siteLng) && !(siteLat === 0 && siteLng === 0)) {
      distanceToSiteMeters = Math.round(
        this.distanceMeters(current.latitude, current.longitude, siteLat, siteLng),
      );
    }

    let status: LocationQualityStatus = 'ok';
    let reasonCode: string | undefined;
    let reason: string | undefined;
    if (!Number.isFinite(accuracy) || accuracy <= 0) {
      status = 'weak';
      reasonCode = 'unknown_accuracy';
      reason = '定位精度未知';
    } else if (!accuracyOk) {
      status = 'weak';
      reasonCode = 'weak_accuracy';
      reason = `定位精度约 ${Math.round(accuracy)} 米，弱于建议阈值 ${maxAccuracy} 米`;
    } else if (!fresh) {
      status = 'weak';
      reasonCode = 'stale';
      reason = '定位时间偏旧，已按弱定位留痕';
    }

    return this.buildCapture({
      status,
      latitude: Number(current.latitude.toFixed(7)),
      longitude: Number(current.longitude.toFixed(7)),
      accuracyMeters: Number.isFinite(accuracy) && accuracy > 0 ? Math.round(accuracy) : 0,
      capturedAt,
      siteName: site.name,
      distanceToSiteMeters,
      reasonCode,
      reason,
    });
  }

  private buildCapture(input: {
    status: LocationQualityStatus;
    latitude: number | null;
    longitude: number | null;
    accuracyMeters: number;
    siteName: string;
    capturedAt?: string;
    distanceToSiteMeters?: number;
    reasonCode?: string;
    reason?: string;
  }): LocationCapture {
    const now = new Date().toISOString();
    return {
      verified: input.status === 'ok',
      status: input.status,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      capturedAt: input.capturedAt || now,
      checkedAt: now,
      siteName: input.siteName,
      distanceToSiteMeters: input.distanceToSiteMeters,
      distanceMeters: input.distanceToSiteMeters ?? 0,
      radiusMeters: 0,
      reasonCode: input.reasonCode,
      reason: input.reason,
    };
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

  private isFreshTime(value: string | undefined, maxAgeMs: number) {
    const timestamp = value ? Date.parse(value) : Number.NaN;
    const age = Date.now() - timestamp;
    return Number.isFinite(timestamp) && age >= -60_000 && age <= maxAgeMs;
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
