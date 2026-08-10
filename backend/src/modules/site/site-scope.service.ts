import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Site, SiteMember } from '../../entities';
import { CommonStatus, SiteMemberRole } from '../../common/enums';

/** 解析用户在网格侧的正/副网格长网格与巡检网格 */
@Injectable()
export class SiteScopeService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteMember)
    private readonly siteMemberRepo: Repository<SiteMember>,
  ) {}

  /** 正网格长网格 + 副网格长网格（去重） */
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

  /** 作为工程师加入的网格（可多站） */
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
