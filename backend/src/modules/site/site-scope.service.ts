import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Site, SiteMember } from '../../entities';
import { CommonStatus, SiteMemberRole } from '../../common/enums';

/** 解析用户在站点侧的正/副站长站点与巡检站点 */
@Injectable()
export class SiteScopeService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteMember)
    private readonly siteMemberRepo: Repository<SiteMember>,
  ) {}

  /** 正站长站点 + 副站长站点（去重） */
  async getManagedSiteIds(userId: string): Promise<string[]> {
    const primary = await this.siteRepo
      .createQueryBuilder('site')
      .where('site.managerId = :userId', { userId })
      .andWhere('site.status = :status', { status: CommonStatus.ACTIVE })
      .andWhere('site.deletedAt IS NULL')
      .select(['site.id'])
      .getMany();

    const deputies = await this.siteMemberRepo.find({
      where: {
        userId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
      select: ['siteId'],
    });

    return [...new Set([...primary.map((s) => s.id), ...deputies.map((d) => d.siteId)])];
  }

  /** 作为巡检员加入的站点（可多站） */
  async getInspectorSiteIds(userId: string): Promise<string[]> {
    const memberships = await this.siteMemberRepo.find({
      where: {
        userId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.INSPECTOR,
      },
      select: ['siteId'],
    });
    return memberships.map((m) => m.siteId);
  }

  async getManagedSitesBrief(userId: string) {
    const ids = await this.getManagedSiteIds(userId);
    if (!ids.length) return [];
    return this.siteRepo.find({
      where: { id: In(ids), deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }
}
