import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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

    if (currentUser.role === UserRole.SITE_MANAGER) {
      // 正/副网格长：可见工程师与网格长账号（排除超管）
      const insp = qbUserHasRole('user', UserRole.INSPECTOR, 'inspector');
      const mgr = qbUserHasRole('user', UserRole.SITE_MANAGER, 'manager');
      const admin = qbUserHasRole('user', UserRole.SUPER_ADMIN, 'admin');
      qb.andWhere(`((${insp.sql}) OR (${mgr.sql}))`, {
        ...insp.params,
        ...mgr.params,
      });
      qb.andWhere(`NOT (${admin.sql})`, admin.params);
      if (query.role === UserRole.INSPECTOR || query.role === UserRole.SITE_MANAGER) {
        const filter = qbUserHasRole('user', query.role, 'filter');
        qb.andWhere(filter.sql, filter.params);
      }
    } else if (query.role) {
      const cond = qbUserHasRole('user', query.role, 'filter');
      qb.andWhere(cond.sql, cond.params);
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

    return {
      list: list.map((u) => this.toSafeUser(u)),
      total,
      page,
      limit,
    };
  }

  async create(dto: CreateUserDto, currentUser: CurrentUserContext) {
    await this.assertCanStaffAccounts(currentUser);
    const roles = this.normalizeRolesInput(dto.roles, dto.role);
    this.assertAllowedRolesForCreate(roles, currentUser);

    const existsUsername = await this.userRepo.findOne({
      where: { username: dto.username },
    });
    if (existsUsername) throw new ConflictException('用户名已存在');

    const existsPhone = await this.userRepo.findOne({ where: { phone: dto.phone } });
    if (existsPhone) throw new ConflictException('手机号已存在');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      username: dto.username,
      password: hashed,
      realName: dto.realName,
      phone: dto.phone,
      email: dto.email || undefined,
      region: dto.region || undefined,
      orgUnit: dto.orgUnit || undefined,
      status: CommonStatus.ACTIVE,
      role: roles[0],
      roles: [],
    } as Partial<User>);
    applyUserRoles(user, roles);

    const saved = await this.userRepo.save(user);
    return this.toSafeUser(saved);
  }

  async update(id: string, dto: UpdateUserDto, currentUser: CurrentUserContext) {
    const user = await this.getUserOrThrow(id);
    this.assertCanManage(user, currentUser);
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
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.region !== undefined && { region: dto.region }),
      ...(dto.orgUnit !== undefined && { orgUnit: dto.orgUnit }),
      ...(dto.avatar !== undefined && { avatar: dto.avatar }),
    });

    if (dto.roles || dto.role) {
      const roles = this.normalizeRolesInput(dto.roles, dto.role);
      this.assertAllowedRolesForUpdate(roles, currentUser, user);
      applyUserRoles(user, roles);
    }

    const saved = await this.userRepo.save(user);
    return this.toSafeUser(saved);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, currentUser: CurrentUserContext) {
    const user = await this.getUserOrThrow(id);
    this.assertCanManage(user, currentUser);
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
    this.assertCanManage(user, currentUser);
    if (currentUser.role === UserRole.SITE_MANAGER) {
      await this.assertCanStaffAccounts(currentUser);
    }
    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
    return { success: true };
  }

  async getInspectorPool(query: QueryPoolDto, currentUser: CurrentUserContext) {
    // 人才池仅正/副网格长用于聘用；管理员不走此路径
    if (currentUser.role !== UserRole.SITE_MANAGER) {
      throw new ForbiddenException('仅网格长可查看人才池，请由正网格长聘用工程师');
    }

    const page = query.page || 1;
    const limit = query.limit || 10;

    const roleCond = qbUserHasRole('user', UserRole.INSPECTOR, 'pool');
    const qb = this.userRepo
      .createQueryBuilder('user')
      .where(roleCond.sql, roleCond.params)
      .andWhere('user.status = :status', { status: CommonStatus.ACTIVE });

    if (query.keyword) {
      qb.andWhere(
        '(user.username ILIKE :kw OR user.realName ILIKE :kw OR user.phone ILIKE :kw OR user.region ILIKE :kw)',
        { kw: `%${query.keyword}%` },
      );
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

  /** 管理员任意；网格长须至少担任一个站的正网格长 */
  private async assertCanStaffAccounts(currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      const n = await this.siteRepo.count({
        where: { managerId: currentUser.id, deletedAt: IsNull() },
      });
      if (n > 0) return;
      throw new ForbiddenException('仅正网格长可创建或管理副网格长/工程师账号');
    }
    throw new ForbiddenException('无权创建或管理账号');
  }

  private normalizeRolesInput(roles?: UserRole[], role?: UserRole): UserRole[] {
    if (roles?.length) return [...new Set(roles)];
    if (role) return [role];
    throw new BadRequestException('请至少选择一个角色');
  }

  /** 管理员只建网格长；正网格长可建网格长+工程师 */
  private assertAllowedRolesForCreate(roles: UserRole[], currentUser: CurrentUserContext) {
    if (roles.includes(UserRole.SUPER_ADMIN) && currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('无权创建超级管理员');
    }
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      const onlyManager =
        roles.length > 0 && roles.every((r) => r === UserRole.SITE_MANAGER);
      if (!onlyManager) {
        throw new ForbiddenException('管理员只能创建网格长账号；工程师由正网格长创建');
      }
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      const allowed = roles.every(
        (r) => r === UserRole.INSPECTOR || r === UserRole.SITE_MANAGER,
      );
      if (!allowed || !roles.length) {
        throw new ForbiddenException('网格长只能创建网格长或工程师账号');
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
      const onlyManager =
        roles.length > 0 && roles.every((r) => r === UserRole.SITE_MANAGER);
      if (!onlyManager) {
        throw new ForbiddenException('管理员只能将账号设为网格长角色');
      }
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      const allowed = roles.every(
        (r) => r === UserRole.INSPECTOR || r === UserRole.SITE_MANAGER,
      );
      if (!allowed || !roles.length) {
        throw new ForbiddenException('网格长只能设置网格长或工程师角色');
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

  private assertCanManage(target: User, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      if (userHasRole(target, UserRole.SUPER_ADMIN) && target.id !== currentUser.id) {
        // 超管可管其他超管账号的基础信息；角色变更另有校验
      }
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (userHasRole(target, UserRole.SUPER_ADMIN)) {
        throw new ForbiddenException('无权管理超级管理员');
      }
      if (
        !userHasRole(target, UserRole.INSPECTOR) &&
        !userHasRole(target, UserRole.SITE_MANAGER)
      ) {
        throw new ForbiddenException('网格长只能管理网格长或工程师账号');
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
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
