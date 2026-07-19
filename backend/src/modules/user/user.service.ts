import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, SiteMember } from '../../entities';
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
  ) {}

  async findAll(query: QueryUserDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;

    const qb = this.userRepo.createQueryBuilder('user');

    if (currentUser.role === UserRole.SITE_MANAGER) {
      // 站长视角：具备巡检员角色的账号
      const cond = qbUserHasRole('user', UserRole.INSPECTOR, 'inspector');
      qb.andWhere(cond.sql, cond.params);
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
    const roles = this.normalizeRolesInput(dto.roles, dto.role);

    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (roles.length !== 1 || roles[0] !== UserRole.INSPECTOR) {
        throw new ForbiddenException('站长只能创建巡检员账号');
      }
    }

    if (roles.includes(UserRole.SUPER_ADMIN) && currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('无权创建超级管理员');
    }

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

    if (dto.phone && dto.phone !== user.phone) {
      const existsPhone = await this.userRepo.findOne({ where: { phone: dto.phone } });
      if (existsPhone) throw new ConflictException('手机号已存在');
    }

    if ((dto.roles || dto.role) && currentUser.role === UserRole.SITE_MANAGER) {
      throw new ForbiddenException('站长无权修改用户角色');
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
      if (roles.includes(UserRole.SUPER_ADMIN) && currentUser.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('无权设置超级管理员');
      }
      applyUserRoles(user, roles);
    }

    const saved = await this.userRepo.save(user);
    return this.toSafeUser(saved);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, currentUser: CurrentUserContext) {
    const user = await this.getUserOrThrow(id);
    this.assertCanManage(user, currentUser);
    if (user.id === currentUser.id) {
      throw new BadRequestException('不能停用自己的账号');
    }
    user.status = dto.status;
    return this.toSafeUser(await this.userRepo.save(user));
  }

  async resetPassword(id: string, dto: ResetPasswordDto, currentUser: CurrentUserContext) {
    const user = await this.getUserOrThrow(id);
    this.assertCanManage(user, currentUser);
    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
    return { success: true };
  }

  async getInspectorPool(query: QueryPoolDto, currentUser: CurrentUserContext) {
    if (currentUser.role !== UserRole.SUPER_ADMIN && currentUser.role !== UserRole.SITE_MANAGER) {
      throw new ForbiddenException('无权查看人才池');
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

  private normalizeRolesInput(roles?: UserRole[], role?: UserRole): UserRole[] {
    if (roles?.length) return [...new Set(roles)];
    if (role) return [role];
    throw new BadRequestException('请至少选择一个角色');
  }

  private async getUserOrThrow(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  private assertCanManage(target: User, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!userHasRole(target, UserRole.INSPECTOR)) {
        throw new ForbiddenException('站长只能管理巡检员');
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
