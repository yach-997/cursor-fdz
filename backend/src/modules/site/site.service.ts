import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { Site, Device, User, SiteMember } from '../../entities';
import { CommonStatus, SiteMemberRole, UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { ensureUserHasRole, userHasRole } from '../../common/utils/user-roles';
import {
  CreateSiteDto,
  UpdateSiteDto,
  QuerySiteDto,
  AppointManagerDto,
  AppointDeputyDto,
  AddMemberDto,
} from './dto/site.dto';

@Injectable()
export class SiteService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SiteMember)
    private readonly siteMemberRepo: Repository<SiteMember>,
  ) {}

  /** 分页查询站点列表（含数据隔离） */
  async findAll(query: QuerySiteDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;

    const qb = this.siteRepo
      .createQueryBuilder('site')
      .where('site.deleted_at IS NULL');

    // 数据隔离：非超管按范围过滤
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.length) {
        return { list: [], total: 0, page, limit };
      }
      qb.andWhere('site.id IN (:...siteIds)', {
        siteIds: currentUser.managedSiteIds,
      });
    } else if (currentUser.role === UserRole.INSPECTOR) {
      if (!currentUser.memberSiteIds.length) {
        return { list: [], total: 0, page, limit };
      }
      qb.andWhere('site.id IN (:...siteIds)', {
        siteIds: currentUser.memberSiteIds,
      });
    }

    if (query.province) {
      const p = query.province.trim().replace(/省$/, '');
      qb.andWhere('site.province ILIKE :province', { province: `%${p}%` });
    }
    if (query.city) {
      const c = query.city.trim().replace(/市$/, '');
      qb.andWhere('site.city ILIKE :city', { city: `%${c}%` });
    }
    if (query.managerId) {
      qb.andWhere('site.manager_id = :managerId', { managerId: query.managerId });
    }
    if (query.status) {
      qb.andWhere('site.status = :status', { status: query.status });
    }
    if (query.keyword) {
      qb.andWhere(
        '(site.name ILIKE :kw OR site.code ILIKE :kw OR site.province ILIKE :kw OR site.city ILIKE :kw OR site.district ILIKE :kw OR site.address ILIKE :kw)',
        { kw: `%${query.keyword}%` },
      );
    }

    qb.orderBy('site.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [list, total] = await qb.getManyAndCount();
    await this.attachManagers(list);

    return {
      list: list.map((s) => this.toSafeSite(s)),
      total,
      page,
      limit,
    };
  }

  /** 获取站点详情 */
  async findOne(id: string, currentUser: CurrentUserContext) {
    const site = await this.siteRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });

    if (!site) {
      throw new NotFoundException('站点不存在');
    }

    await this.attachManagers([site]);
    this.assertSiteAccess(site.id, currentUser);
    return this.toSafeSite(site);
  }

  /** 创建站点（仅超管） */
  async create(dto: CreateSiteDto) {
    const exists = await this.siteRepo.findOne({
      where: { code: dto.code, deletedAt: IsNull() },
    });
    if (exists) {
      throw new ConflictException('站点编码已存在');
    }

    if (dto.managerId) {
      await this.validateManager(dto.managerId);
    }

    const site = this.siteRepo.create({
      name: dto.name,
      code: dto.code,
      province: dto.province,
      city: dto.city,
      district: dto.district,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      managerId: dto.managerId || null,
      status: CommonStatus.ACTIVE,
    });

    const saved = await this.siteRepo.save(site);
    return this.findOneRaw(saved.id);
  }

  /** 更新站点 */
  async update(id: string, dto: UpdateSiteDto, currentUser: CurrentUserContext) {
    const site = await this.getActiveSite(id);

    // 站长只能更新自己管理的站点，且不能改 managerId
    if (currentUser.role === UserRole.SITE_MANAGER) {
      this.assertSiteAccess(id, currentUser);
      if (dto.managerId !== undefined) {
        throw new ForbiddenException('站长无权任命站长');
      }
    }

    if (dto.code && dto.code !== site.code) {
      const exists = await this.siteRepo.findOne({
        where: { code: dto.code, deletedAt: IsNull() },
      });
      if (exists) {
        throw new ConflictException('站点编码已存在');
      }
    }

    if (dto.managerId) {
      await this.validateManager(dto.managerId);
    }

    Object.assign(site, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.province !== undefined && { province: dto.province }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.district !== undefined && { district: dto.district }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.latitude !== undefined && { latitude: dto.latitude }),
      ...(dto.longitude !== undefined && { longitude: dto.longitude }),
      ...(dto.managerId !== undefined && { managerId: dto.managerId }),
      ...(dto.status !== undefined && { status: dto.status }),
    });

    await this.siteRepo.save(site);
    return this.findOneRaw(id);
  }

  /**
   * 软删除站点
   * 业务规则：有设备则禁止删除，返回 400
   */
  async remove(id: string) {
    const site = await this.getActiveSite(id);

    const deviceCount = await this.deviceRepo.count({ where: { siteId: id } });
    if (deviceCount > 0) {
      throw new BadRequestException(
        `该站点下仍有 ${deviceCount} 台设备，请先转移或删除设备后再删除站点`,
      );
    }

    site.deletedAt = new Date();
    site.status = CommonStatus.INACTIVE;
    await this.siteRepo.save(site);

    return { success: true };
  }

  /** 任命正站长（一站仅一名） */
  async appointManager(id: string, dto: AppointManagerDto) {
    const site = await this.getActiveSite(id);
    await this.validateManager(dto.userId);

    site.managerId = dto.userId;
    await this.siteRepo.save(site);

    // 正站长可以同时保留巡检员身份；仅卸去与正站长冲突的副站长任职。
    await this.deactivateDeputyMembership(id, dto.userId);

    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (user) {
      // 保留原有巡检员角色，同时赋予站长角色（一账号多角色）
      ensureUserHasRole(user, UserRole.SITE_MANAGER);
      await this.userRepo.save(user);
    }

    return this.findOneRaw(id);
  }

  /**
   * 任命副站长（可多名）
   * 仅超管或本站正站长可操作；候选人须为站长角色账号
   */
  async appointDeputy(
    id: string,
    dto: AppointDeputyDto,
    currentUser: CurrentUserContext,
  ) {
    const site = await this.getActiveSite(id);
    this.assertPrimaryManagerOrAdmin(site, currentUser);

    if (site.managerId === dto.userId) {
      throw new BadRequestException('正站长不能同时任命为副站长');
    }

    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.status !== CommonStatus.ACTIVE) {
      throw new BadRequestException('该用户已停用');
    }
    if (!userHasRole(user, UserRole.SITE_MANAGER)) {
      throw new BadRequestException(
        '副站长须具备「站长」角色（可在用户管理中为该账号勾选站长）',
      );
    }

    const existing = await this.siteMemberRepo.findOne({
      where: { siteId: id, userId: dto.userId },
    });
    if (existing) {
      if (
        existing.status === CommonStatus.ACTIVE &&
        existing.memberRole === SiteMemberRole.DEPUTY_MANAGER
      ) {
        throw new ConflictException('该用户已是本站副站长');
      }
      existing.memberRole = SiteMemberRole.DEPUTY_MANAGER;
      existing.status = CommonStatus.ACTIVE;
      await this.siteMemberRepo.save(existing);
      return this.toMemberDto(existing, user);
    }

    const member = this.siteMemberRepo.create({
      siteId: id,
      userId: dto.userId,
      memberRole: SiteMemberRole.DEPUTY_MANAGER,
      status: CommonStatus.ACTIVE,
    });
    const saved = await this.siteMemberRepo.save(member);
    return this.toMemberDto(saved, user);
  }

  /** 移除副站长 */
  async removeDeputy(id: string, userId: string, currentUser: CurrentUserContext) {
    const site = await this.getActiveSite(id);
    this.assertPrimaryManagerOrAdmin(site, currentUser);

    const member = await this.siteMemberRepo.findOne({
      where: {
        siteId: id,
        userId,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
    });
    if (!member || member.status !== CommonStatus.ACTIVE) {
      throw new NotFoundException('该用户不是本站副站长');
    }
    member.status = CommonStatus.INACTIVE;
    await this.siteMemberRepo.save(member);
    return { success: true };
  }

  /** 获取站点成员列表 */
  async getMembers(
    id: string,
    currentUser: CurrentUserContext,
    role?: string,
  ) {
    await this.getActiveSite(id);
    this.assertSiteAccess(id, currentUser);

    const qb = this.siteMemberRepo
      .createQueryBuilder('m')
      .where('m.siteId = :siteId', { siteId: id })
      .andWhere('m.status = :status', { status: CommonStatus.ACTIVE })
      .orderBy('m.joinedAt', 'DESC');

    if (role === SiteMemberRole.DEPUTY_MANAGER || role === 'deputy') {
      qb.andWhere('m.memberRole = :r', { r: SiteMemberRole.DEPUTY_MANAGER });
    } else if (role === SiteMemberRole.INSPECTOR || role === 'inspector') {
      qb.andWhere('m.memberRole = :r', { r: SiteMemberRole.INSPECTOR });
    }

    const members = await qb.getMany();
    const userIds = [...new Set(members.map((m) => m.userId))];
    const users = userIds.length
      ? await this.userRepo.findBy({ id: In(userIds) })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return members.map((m) => this.toMemberDto(m, userMap.get(m.userId)));
  }

  /**
   * 聘用巡检员（同一巡检员可同时加入多个站点）
   * 超管 / 正站长 / 副站长均可操作本站
   */
  async addMember(id: string, dto: AddMemberDto, currentUser: CurrentUserContext) {
    const site = await this.getActiveSite(id);
    this.assertLeadershipAccess(site, currentUser);

    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (!userHasRole(user, UserRole.INSPECTOR)) {
      throw new BadRequestException(
        '只能聘用具备「巡检员」角色的用户（可在用户管理中勾选巡检员）',
      );
    }
    if (user.status !== CommonStatus.ACTIVE) {
      throw new BadRequestException('该用户已停用，无法聘用');
    }

    const existing = await this.siteMemberRepo.findOne({
      where: { siteId: id, userId: dto.userId },
    });

    if (existing) {
      if (
        existing.status === CommonStatus.ACTIVE &&
        existing.memberRole === SiteMemberRole.DEPUTY_MANAGER
      ) {
        throw new ConflictException('该用户已是本站副站长，无法同时任巡检员');
      }
      if (
        existing.status === CommonStatus.ACTIVE &&
        existing.memberRole === SiteMemberRole.INSPECTOR
      ) {
        throw new ConflictException('该巡检员已在本站聘用中');
      }
      existing.memberRole = SiteMemberRole.INSPECTOR;
      existing.status = CommonStatus.ACTIVE;
      await this.siteMemberRepo.save(existing);
      return this.toMemberDto(existing, user);
    }

    const member = this.siteMemberRepo.create({
      siteId: id,
      userId: dto.userId,
      memberRole: SiteMemberRole.INSPECTOR,
      status: CommonStatus.ACTIVE,
    });
    const saved = await this.siteMemberRepo.save(member);
    return this.toMemberDto(saved, user);
  }

  /** 解聘巡检员（不影响其在其他站点的聘用） */
  async removeMember(id: string, userId: string, currentUser: CurrentUserContext) {
    const site = await this.getActiveSite(id);
    this.assertLeadershipAccess(site, currentUser);

    const member = await this.siteMemberRepo.findOne({
      where: {
        siteId: id,
        userId,
        memberRole: SiteMemberRole.INSPECTOR,
      },
    });

    if (!member || member.status !== CommonStatus.ACTIVE) {
      throw new NotFoundException('该巡检员未在本站聘用');
    }

    member.status = CommonStatus.INACTIVE;
    await this.siteMemberRepo.save(member);

    return { success: true };
  }

  // —— 私有辅助方法 ——

  private async getActiveSite(id: string): Promise<Site> {
    const site = await this.siteRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!site) {
      throw new NotFoundException('站点不存在');
    }
    return site;
  }

  private async findOneRaw(id: string) {
    const site = await this.siteRepo.findOne({ where: { id } });
    if (!site) {
      throw new NotFoundException('站点不存在');
    }
    await this.attachManagers([site]);
    return this.toSafeSite(site);
  }

  /** 批量挂载站长，避免 relations + orderBy 触发 TypeORM databaseName 错误 */
  private async attachManagers(sites: Site[]) {
    if (!sites.length) return;
    const managerIds = [
      ...new Set(sites.map((s) => s.managerId).filter((id): id is string => !!id)),
    ];
    if (!managerIds.length) return;

    const managers = await this.userRepo.findBy({ id: In(managerIds) });
    const managerMap = new Map(managers.map((m) => [m.id, m]));
    for (const site of sites) {
      if (site.managerId) {
        site.manager = managerMap.get(site.managerId) ?? null;
      }
    }
  }

  private async validateManager(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('站长用户不存在');
    }
    if (user.status !== CommonStatus.ACTIVE) {
      throw new BadRequestException('该用户已停用，无法任命为站长');
    }
    if (
      userHasRole(user, UserRole.SITE_MANAGER) ||
      userHasRole(user, UserRole.INSPECTOR) ||
      userHasRole(user, UserRole.SUPER_ADMIN)
    ) {
      return user;
    }
    throw new BadRequestException('只能任命具备站长或巡检员角色的用户为正站长');
  }

  /** 校验当前用户是否有权访问该站点 */
  private assertSiteAccess(siteId: string, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权访问该站点数据');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (!currentUser.memberSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权访问该站点数据');
      }
    }
  }

  /** 正站长或超管（任命/移除副站长） */
  private assertPrimaryManagerOrAdmin(site: Site, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (
      currentUser.role === UserRole.SITE_MANAGER &&
      site.managerId === currentUser.id
    ) {
      return;
    }
    throw new ForbiddenException('仅超级管理员或本站正站长可管理副站长');
  }

  /** 正站长 / 副站长 / 超管（聘用巡检员） */
  private assertLeadershipAccess(site: Site, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(site.id)) {
        throw new ForbiddenException('无权管理该站点人员');
      }
      return;
    }
    throw new ForbiddenException('无权管理该站点人员');
  }

  private async deactivateDeputyMembership(siteId: string, userId: string) {
    const existing = await this.siteMemberRepo.findOne({
      where: {
        siteId,
        userId,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
    });
    if (existing && existing.status === CommonStatus.ACTIVE) {
      existing.status = CommonStatus.INACTIVE;
      await this.siteMemberRepo.save(existing);
    }
  }

  private toMemberDto(m: SiteMember, user?: User | null) {
    return {
      id: m.id,
      siteId: m.siteId,
      userId: m.userId,
      memberRole: m.memberRole,
      status: m.status,
      joinedAt: m.joinedAt,
      user: user
        ? {
            id: user.id,
            username: user.username,
            realName: user.realName,
            phone: user.phone,
            role: user.role,
            status: user.status,
            avatar: user.avatar,
          }
        : null,
    };
  }

  private toSafeSite(site: Site) {
    return {
      id: site.id,
      name: site.name,
      code: site.code,
      province: site.province,
      city: site.city,
      district: site.district,
      address: site.address,
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
      managerId: site.managerId,
      status: site.status,
      createdAt: site.createdAt,
      manager: site.manager
        ? {
            id: site.manager.id,
            username: site.manager.username,
            realName: site.manager.realName,
            phone: site.manager.phone,
          }
        : null,
    };
  }
}
