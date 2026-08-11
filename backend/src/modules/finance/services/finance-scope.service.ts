import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Site, SiteMember, User } from '../../../entities';
import { CommonStatus, SiteMemberRole, UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';

export type FinancePeopleFilter = {
  siteId?: string;
  role?: 'site_manager' | 'inspector';
  keyword?: string;
};

/**
 * 费用数据权限。
 * 归属区域仅为人员档案/统计元数据，不再作为 ACL。
 * 网格长权限以「管理的网格」为准：可跨省管人、跨网格派单。
 */
@Injectable()
export class FinanceScopeService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(SiteMember) private readonly members: Repository<SiteMember>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
  ) {}

  /** 可选元数据；未配置不报错，也不再用于强制过滤 */
  async region(user: CurrentUserContext): Promise<string | null> {
    if (user.role === UserRole.SUPER_ADMIN) return null;
    const current = await this.users.findOne({
      where: { id: user.id },
      select: { id: true, region: true },
    });
    return current?.region || null;
  }

  /** @deprecated 区域不再作为费用 ACL；保留空实现避免旧调用报错 */
  async assertRegion(_user: CurrentUserContext, _targetRegion: string | null) {
    void _user;
    void _targetRegion;
  }

  /** 案例访问：管理员全量；网格长仅已挂到自己管理网格的案例（未挂网格不可见） */
  assertCaseAccess(
    user: CurrentUserContext,
    serviceCase: { siteId?: string | null },
  ) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (user.role !== UserRole.SITE_MANAGER) {
      throw new ForbiddenException('无权访问费用案例');
    }
    if (!serviceCase.siteId || !user.managedSiteIds?.includes(serviceCase.siteId)) {
      throw new ForbiddenException('无权操作其他网格的案例');
    }
  }

  /** 网格长管辖网格下的工程师 userId */
  async inspectorIdsOfSites(siteIds: string[]): Promise<string[]> {
    if (!siteIds.length) return [];
    const rows = await this.members.find({
      where: {
        siteId: In(siteIds),
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.INSPECTOR,
      },
      select: ['userId'],
    });
    return [...new Set(rows.map((item) => item.userId))];
  }

  /** 工程师 → 首个所属网格（用于网格内名次计算） */
  async primarySiteIdByInspectors(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!userIds.length) return map;
    const rows = await this.members.find({
      where: {
        userId: In(userIds),
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.INSPECTOR,
      },
      select: ['userId', 'siteId', 'joinedAt'],
      order: { joinedAt: 'ASC' },
    });
    for (const row of rows) {
      if (!map.has(row.userId)) map.set(row.userId, row.siteId);
    }
    return map;
  }

  async siteNameMap(siteIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!siteIds.length) return map;
    const rows = await this.sites.find({
      where: { id: In(siteIds) },
      select: { id: true, name: true },
    });
    rows.forEach((row) => map.set(row.id, row.name));
    return map;
  }

  /** 网格长（正/副）管理的网格名称，多人多站时用顿号拼接 */
  async managedSiteNamesByUsers(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!userIds.length) return map;
    const byUser = new Map<string, string[]>();
    const push = (userId: string, name: string) => {
      const list = byUser.get(userId) || [];
      if (!list.includes(name)) list.push(name);
      byUser.set(userId, list);
    };

    const primarySites = await this.sites.find({
      where: { managerId: In(userIds), status: CommonStatus.ACTIVE, deletedAt: IsNull() },
      select: { id: true, name: true, managerId: true },
    });
    for (const site of primarySites) {
      if (site.managerId && site.name) push(site.managerId, site.name);
    }

    const deputies = await this.members.find({
      where: {
        userId: In(userIds),
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
      select: ['userId', 'siteId'],
    });
    const deputySiteIds = [...new Set(deputies.map((d) => d.siteId))];
    const deputyNames = await this.siteNameMap(deputySiteIds);
    for (const row of deputies) {
      const name = deputyNames.get(row.siteId);
      if (name) push(row.userId, name);
    }

    for (const [userId, names] of byUser) {
      map.set(userId, names.join('、'));
    }
    return map;
  }

  /** 某网格相关人员：本网格工程师 + 正/副网格长 */
  async peopleIdsOfSite(siteId: string): Promise<string[]> {
    const inspectors = await this.inspectorIdsOfSites([siteId]);
    const site = await this.sites.findOne({
      where: { id: siteId },
      select: { id: true, managerId: true },
    });
    const deputies = await this.members.find({
      where: {
        siteId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
      select: ['userId'],
    });
    const ids = [
      ...inspectors,
      ...(site?.managerId ? [site.managerId] : []),
      ...deputies.map((item) => item.userId),
    ];
    return [...new Set(ids)];
  }

  async assertPersonAccess(user: CurrentUserContext, targetUserId: string) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (user.role !== UserRole.SITE_MANAGER) {
      throw new ForbiddenException('无权操作该人员');
    }
    const allowed = await this.inspectorIdsOfSites(user.managedSiteIds || []);
    if (!allowed.includes(targetUserId)) {
      throw new ForbiddenException('只能操作本网格工程师');
    }
  }

  /**
   * 考核/月结可见人员：
   * - 管理员：全量网格长+工程师（可筛网格/角色/关键词）
   * - 网格长：仅管辖网格下的工程师
   */
  async listVisiblePeople(user: CurrentUserContext, filters: FinancePeopleFilter = {}) {
    const qb = this.users
      .createQueryBuilder('u')
      .where('u.status = :status', { status: CommonStatus.ACTIVE })
      .andWhere('(u.roles ? :manager OR u.roles ? :inspector OR u.role IN (:...roles))', {
        manager: UserRole.SITE_MANAGER,
        inspector: UserRole.INSPECTOR,
        roles: [UserRole.SITE_MANAGER, UserRole.INSPECTOR],
      });

    if (user.role === UserRole.SITE_MANAGER) {
      const siteIds = user.managedSiteIds || [];
      // 已聘为本网格工程师的成员（含「网格长兼工程师」且已聘网格的人）
      const inspectorIds = await this.inspectorIdsOfSites(siteIds);
      if (!inspectorIds.length) return [];
      qb.andWhere('u.id IN (:...inspectorIds)', { inspectorIds });
      qb.andWhere('(u.roles ? :onlyInspector OR u.role = :onlyInspectorRole)', {
        onlyInspector: UserRole.INSPECTOR,
        onlyInspectorRole: UserRole.INSPECTOR,
      });
    } else {
      if (filters.siteId) {
        const sitePeople = await this.peopleIdsOfSite(filters.siteId);
        if (!sitePeople.length) return [];
        qb.andWhere('u.id IN (:...sitePeople)', { sitePeople });
      }
      if (filters.role === 'inspector') {
        // 纯工程师 + 兼工程师的网格长
        qb.andWhere('(u.roles ? :filterInspector OR u.role = :filterInspectorRole)', {
          filterInspector: UserRole.INSPECTOR,
          filterInspectorRole: UserRole.INSPECTOR,
        });
      } else if (filters.role === 'site_manager') {
        qb.andWhere('(u.roles ? :filterManager2 OR u.role = :filterManagerRole)', {
          filterManager2: UserRole.SITE_MANAGER,
          filterManagerRole: UserRole.SITE_MANAGER,
        });
      }
    }

    if (filters.keyword?.trim()) {
      qb.andWhere('(u.real_name ILIKE :kw OR u.username ILIKE :kw OR u.phone ILIKE :kw)', {
        kw: `%${filters.keyword.trim()}%`,
      });
    }

    return qb.orderBy('u.real_name', 'ASC').getMany();
  }
}
