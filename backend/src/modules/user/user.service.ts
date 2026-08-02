import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, SiteMember, Site } from '../../entities';
import { UserRole, CommonStatus, SiteMemberRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import {
  CreateUserDto,
  UpdateUserDto,
  QueryUserDto,
  UpdateUserStatusDto,
  ResetPasswordDto,
  QueryPoolDto,
} from './dto/user.dto';
import {
  applyUserRoles,
  ensureUserHasRole,
  getUserRoles,
  qbUserHasRole,
  userHasRole,
} from '../../common/utils/user-roles';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SiteMember)
    private readonly siteMemberRepo: Repository<SiteMember>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
  ) {}

  async findAll(query: QueryUserDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const qb = this.userRepo.createQueryBuilder('user');

    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 管理员：只看自己设立的正网格长账号
      const mgr = qbUserHasRole('user', UserRole.SITE_MANAGER, 'manager');
      const admin = qbUserHasRole('user', UserRole.SUPER_ADMIN, 'admin');
      qb.andWhere(mgr.sql, mgr.params);
      qb.andWhere(`NOT (${admin.sql})`, admin.params);
      qb.andWhere('user.created_by = :creatorId', { creatorId: currentUser.id });
      if (query.role && query.role !== UserRole.SITE_MANAGER) {
        // 管理员视图不允许筛出工程师等
        return { list: [], total: 0, page, limit };
      }
    } else if (currentUser.role === UserRole.SITE_MANAGER) {
      const creatorIds = await this.getStaffingCreatorIds(currentUser.id);
      // 无编制池时仍返回本人（管理员创建的正网格长默认不在池内）
      if (creatorIds.length) {
        // 正/副网格长权限相同：共享所管站点编制池，A/B 站互不可见
        qb.andWhere('user.created_by IN (:...creatorIds)', { creatorIds });
        if (query.role === UserRole.INSPECTOR || query.role === UserRole.SITE_MANAGER) {
          const filter = qbUserHasRole('user', query.role, 'filter');
          qb.andWhere(filter.sql, filter.params);
        } else if (query.role) {
          return this.withSelfOnFirstPage([], 0, page, limit, query, currentUser);
        }
      } else {
        // 强制空结果，后面再注入本人
        qb.andWhere('1 = 0');
      }
    } else {
      throw new ForbiddenException('无权查看用户列表');
    }

    if (query.status) {
      qb.andWhere('user.status = :status', { status: query.status });
    }

    if (query.keyword) {
      qb.andWhere('(user.username ILIKE :kw OR user.realName ILIKE :kw OR user.phone ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }

    qb.orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [list, total] = await qb.getManyAndCount();
    return this.withSelfOnFirstPage(
      list.map((u) => this.toSafeUser(u)),
      total,
      page,
      limit,
      query,
      currentUser,
    );
  }

  /** 网格长本人由管理员创建，默认不在编制池；首页插入本人便于查看/开通工程师 */
  private async withSelfOnFirstPage(
    rows: ReturnType<UserService['toSafeUser']>[],
    total: number,
    page: number,
    limit: number,
    query: QueryUserDto,
    currentUser: CurrentUserContext,
  ) {
    let finalRows = rows;
    let finalTotal = total;
    if (currentUser.role === UserRole.SITE_MANAGER && page === 1) {
      const self = await this.getUserOrThrow(currentUser.id);
      const selfMatchRole =
        !query.role ||
        (query.role === UserRole.SITE_MANAGER && userHasRole(self, UserRole.SITE_MANAGER)) ||
        (query.role === UserRole.INSPECTOR && userHasRole(self, UserRole.INSPECTOR));
      const selfMatchStatus = !query.status || self.status === query.status;
      const kw = query.keyword?.trim();
      const selfMatchKw =
        !kw ||
        self.username.includes(kw) ||
        self.realName.includes(kw) ||
        self.phone.includes(kw);
      if (
        selfMatchRole &&
        selfMatchStatus &&
        selfMatchKw &&
        !finalRows.some((u) => u.id === self.id)
      ) {
        finalRows = [this.toSafeUser(self), ...finalRows];
        finalTotal += 1;
      }
    }
    return { list: finalRows, total: finalTotal, page, limit };
  }

  async create(dto: CreateUserDto, currentUser: CurrentUserContext) {
    await this.assertCanStaffAccounts(currentUser);
    const roles = this.normalizeRolesInput(dto.roles, dto.role);
    this.assertAllowedRolesForCreate(roles, currentUser);

    const existsUsername = await this.userRepo.findOne({
      where: { username: dto.username },
    });
    const existsPhone = await this.userRepo.findOne({ where: { phone: dto.phone } });
    const selfAccount =
      currentUser.role === UserRole.SITE_MANAGER
        ? existsUsername?.id === currentUser.id || existsPhone?.id === currentUser.id
          ? existsUsername?.id === currentUser.id
            ? existsUsername!
            : existsPhone!
          : null
        : null;

    // 正网格长不能给自己设副网格长；只能给自己开通工程师
    if (selfAccount) {
      if (roles.includes(UserRole.SITE_MANAGER)) {
        throw new BadRequestException(
          '正网格长不能给自己设立副网格长（角色冲突）；如需登 H5，请只勾选「工程师」或点「开通我的工程师身份」',
        );
      }
      if (!roles.includes(UserRole.INSPECTOR)) {
        throw new BadRequestException('给自己开通时请勾选「工程师」');
      }
      return this.grantInspectorRole(selfAccount);
    }

    if (existsUsername) throw new ConflictException('用户名已存在');
    if (existsPhone) throw new ConflictException('手机号已存在');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      username: dto.username,
      password: hashed,
      realName: dto.realName,
      phone: dto.phone,
      status: CommonStatus.ACTIVE,
      role: roles[0],
      roles: [],
      createdBy: currentUser.id,
    } as Partial<User>);
    applyUserRoles(user, roles);

    const saved = await this.userRepo.save(user);
    return this.toSafeUser(saved);
  }

  /** 正/副网格长为自己开通工程师身份（同一账号可登 H5） */
  async enableMyInspector(currentUser: CurrentUserContext) {
    if (currentUser.role !== UserRole.SITE_MANAGER) {
      throw new ForbiddenException('仅正/副网格长可为自己开通工程师身份');
    }
    await this.assertCanStaffAccounts(currentUser);
    const self = await this.getUserOrThrow(currentUser.id);
    return this.grantInspectorRole(self);
  }

  private async grantInspectorRole(user: User) {
    ensureUserHasRole(user, UserRole.INSPECTOR);
    // 确保 roles jsonb 与 legacy role 同步落库
    applyUserRoles(user, getUserRoles(user));
    const saved = await this.userRepo.save(user);
    return this.toSafeUser(saved);
  }

  async update(id: string, dto: UpdateUserDto, currentUser: CurrentUserContext) {
    const user = await this.getUserOrThrow(id);
    await this.assertCanManage(user, currentUser);
    if (currentUser.role === UserRole.SITE_MANAGER) {
      await this.assertCanStaffAccounts(currentUser);
    }

    if (dto.phone && dto.phone !== user.phone) {
      const existsPhone = await this.userRepo.findOne({ where: { phone: dto.phone } });
      if (existsPhone) throw new ConflictException('手机号已存在');
    }

    Object.assign(user, {
      ...(dto.realName !== undefined && { realName: dto.realName }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.avatar !== undefined && { avatar: dto.avatar }),
    });

    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 管理员保证正网格长身份，但保留对方自行开通的工程师身份
      const next = new Set(getUserRoles(user));
      next.add(UserRole.SITE_MANAGER);
      next.delete(UserRole.SUPER_ADMIN);
      applyUserRoles(user, [...next]);
    } else if (dto.roles || dto.role) {
      const roles = this.normalizeRolesInput(dto.roles, dto.role);
      if (user.id === currentUser.id && currentUser.role === UserRole.SITE_MANAGER) {
        // 自己：保留网格长身份，只可附加工程师；不能「改成副网格长」
        const next: UserRole[] = [UserRole.SITE_MANAGER];
        if (roles.includes(UserRole.INSPECTOR)) next.push(UserRole.INSPECTOR);
        applyUserRoles(user, next);
      } else {
        this.assertAllowedRolesForUpdate(roles, currentUser, user);
        applyUserRoles(user, roles);
      }
    }

    const saved = await this.userRepo.save(user);
    return this.toSafeUser(saved);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, currentUser: CurrentUserContext) {
    const user = await this.getUserOrThrow(id);
    await this.assertCanManage(user, currentUser);
    if (currentUser.role === UserRole.SITE_MANAGER) {
      await this.assertCanStaffAccounts(currentUser);
    }
    if (user.id === currentUser.id) {
      throw new BadRequestException('不能停用自己的账号');
    }
    user.status = dto.status;
    return this.toSafeUser(await this.userRepo.save(user));
  }

  async resetPassword(id: string, dto: ResetPasswordDto, currentUser: CurrentUserContext) {
    const user = await this.getUserOrThrow(id);
    await this.assertCanManage(user, currentUser);
    if (currentUser.role === UserRole.SITE_MANAGER) {
      await this.assertCanStaffAccounts(currentUser);
    }
    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
    return { success: true };
  }

  async getInspectorPool(query: QueryPoolDto, currentUser: CurrentUserContext) {
    if (
      currentUser.role !== UserRole.SITE_MANAGER &&
      currentUser.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException('无权查看工程师列表');
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const roleCond = qbUserHasRole('user', UserRole.INSPECTOR, 'pool');
    const qb = this.userRepo
      .createQueryBuilder('user')
      .where(roleCond.sql, roleCond.params)
      .andWhere('user.status = :status', { status: CommonStatus.ACTIVE });

    // 网格长：仅看本站编制创建人下的工程师；超管：全部工程师（供历史查询等筛选）
    if (currentUser.role === UserRole.SITE_MANAGER) {
      await this.assertCanStaffAccounts(currentUser);
      const creatorIds = await this.getStaffingCreatorIds(currentUser.id);
      if (!creatorIds.length) {
        return { list: [], total: 0, page, limit };
      }
      qb.andWhere('user.created_by IN (:...creatorIds)', { creatorIds });
    }

    if (query.keyword) {
      qb.andWhere('(user.username ILIKE :kw OR user.realName ILIKE :kw OR user.phone ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }

    qb.orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [list, total] = await qb.getManyAndCount();
    const result: Array<ReturnType<UserService['toSafeUser']> & { membershipCount: number }> = [];
    for (const u of list) {
      const membershipCount = await this.siteMemberRepo.count({
        where: {
          userId: u.id,
          status: CommonStatus.ACTIVE,
          memberRole: SiteMemberRole.INSPECTOR,
        },
      });
      result.push({ ...this.toSafeUser(u), membershipCount });
    }

    return { list: result, total, page, limit };
  }

  /** 所管站点（正+副）上的编制创建人：自己、各站正网格长、各站副网格长 */
  private async getStaffingCreatorIds(userId: string): Promise<string[]> {
    const primarySites = await this.siteRepo.find({
      where: { managerId: userId, deletedAt: IsNull() },
      select: ['id', 'managerId'],
    });
    const deputyRows = await this.siteMemberRepo.find({
      where: {
        userId,
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
      select: ['siteId'],
    });
    const siteIds = [...new Set([...primarySites.map((s) => s.id), ...deputyRows.map((d) => d.siteId)])];
    if (!siteIds.length) return [];

    const sites = await this.siteRepo.find({
      where: { id: In(siteIds), deletedAt: IsNull() },
      select: ['id', 'managerId'],
    });
    const ids = new Set<string>([userId]);
    for (const s of sites) {
      if (s.managerId) ids.add(s.managerId);
    }
    const deputies = await this.siteMemberRepo.find({
      where: {
        siteId: In(siteIds),
        status: CommonStatus.ACTIVE,
        memberRole: SiteMemberRole.DEPUTY_MANAGER,
      },
      select: ['userId'],
    });
    for (const d of deputies) ids.add(d.userId);
    return [...ids];
  }

  private async canStaffAsGridManager(userId: string): Promise<boolean> {
    const ids = await this.getStaffingCreatorIds(userId);
    return ids.length > 0;
  }

  /** 管理员任意；正/副网格长（已任职站点）可编制 */
  private async assertCanStaffAccounts(currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (await this.canStaffAsGridManager(currentUser.id)) return;
      throw new ForbiddenException('请先由管理员任命为正网格长，或由正网格长任命为副网格长后再编制账号');
    }
    throw new ForbiddenException('无权创建或管理账号');
  }

  private normalizeRolesInput(roles?: UserRole[], role?: UserRole): UserRole[] {
    if (roles?.length) return [...new Set(roles)];
    if (role) return [role];
    throw new BadRequestException('请至少选择一个角色');
  }

  /** 管理员→仅正网格长；正/副网格长→副网格长和/或工程师（可兼岗以便同一人登 PC+H5） */
  private assertAllowedRolesForCreate(roles: UserRole[], currentUser: CurrentUserContext) {
    if (roles.includes(UserRole.SUPER_ADMIN) && currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('无权创建超级管理员');
    }
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      if (roles.length !== 1 || roles[0] !== UserRole.SITE_MANAGER) {
        throw new ForbiddenException('管理员只能创建正网格长账号；工程师由正/副网格长设立');
      }
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      const allowed = roles.every(
        (r) => r === UserRole.INSPECTOR || r === UserRole.SITE_MANAGER,
      );
      if (!allowed || !roles.length) {
        throw new ForbiddenException('正/副网格长只能设立副网格长或工程师');
      }
      return;
    }
    throw new ForbiddenException('无权创建用户');
  }

  private assertAllowedRolesForUpdate(
    roles: UserRole[],
    currentUser: CurrentUserContext,
    target: User,
  ) {
    if (roles.includes(UserRole.SUPER_ADMIN) && currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('无权设置超级管理员');
    }
    if (userHasRole(target, UserRole.SUPER_ADMIN) && currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('无权修改超级管理员');
    }
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      if (!roles.includes(UserRole.SITE_MANAGER) || roles.includes(UserRole.SUPER_ADMIN)) {
        throw new ForbiddenException('管理员只能保持正网格长角色');
      }
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      const allowed = roles.every(
        (r) => r === UserRole.INSPECTOR || r === UserRole.SITE_MANAGER,
      );
      if (!allowed || !roles.length) {
        throw new ForbiddenException('正/副网格长只能设置副网格长或工程师角色');
      }
      return;
    }
    throw new ForbiddenException('无权修改用户角色');
  }

  private async getUserOrThrow(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  /** 管理员管自己设立的正网格长；正/副网格长管本站编制池内账号 */
  private async assertCanManage(target: User, currentUser: CurrentUserContext) {
    if (userHasRole(target, UserRole.SUPER_ADMIN)) {
      throw new ForbiddenException('无权管理超级管理员');
    }
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      if (!userHasRole(target, UserRole.SITE_MANAGER)) {
        throw new ForbiddenException('管理员只能管理正网格长账号');
      }
      if (target.createdBy !== currentUser.id) {
        throw new ForbiddenException('只能管理自己设立的正网格长');
      }
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (target.id === currentUser.id) return;
      const creatorIds = await this.getStaffingCreatorIds(currentUser.id);
      if (!creatorIds.length) {
        throw new ForbiddenException('未任职站点，无权管理下属账号');
      }
      if (!target.createdBy || !creatorIds.includes(target.createdBy)) {
        throw new ForbiddenException('只能管理本站正/副网格长设立的副网格长与工程师');
      }
      if (
        !userHasRole(target, UserRole.INSPECTOR) &&
        !userHasRole(target, UserRole.SITE_MANAGER)
      ) {
        throw new ForbiddenException('只能管理副网格长或工程师账号');
      }
      return;
    }
    throw new ForbiddenException('无权操作该用户');
  }

  private toSafeUser(user: User) {
    const roles = getUserRoles(user);
    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      roles,
      status: user.status,
      region: user.region,
      orgUnit: user.orgUnit,
      createdBy: user.createdBy,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
