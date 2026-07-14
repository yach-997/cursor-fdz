import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, SiteMember, Site } from '../../entities';
import { CommonStatus, SiteMemberRole, UserRole } from '../../common/enums';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto, ChangePasswordDto } from './dto/profile.dto';
import { CurrentUserContext, LoginClient } from '../../common/interfaces';
import { SiteScopeService } from '../site/site-scope.service';
import { applyUserRoles, getUserRoles, userHasRole } from '../../common/utils/user-roles';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SiteMember)
    private readonly siteMemberRepo: Repository<SiteMember>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly siteScope: SiteScopeService,
  ) {}

  /** 登录：按 client 选择生效角色（PC=站长端，H5=巡检端） */
  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({
      where: { username: dto.username.trim() },
    });

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (user.status !== CommonStatus.ACTIVE) {
      throw new UnauthorizedException('账号已停用，请联系管理员');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 兼容旧数据：补齐 roles
    if (!user.roles?.length && user.role) {
      applyUserRoles(user, [user.role]);
      await this.userRepo.save(user);
    }

    const client: LoginClient = dto.client || 'pc';
    const activeRole = await this.resolveActiveRole(user, client);
    const tokens = await this.generateTokens(user, activeRole, client);
    const userInfo = await this.buildUserInfo(user, activeRole);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: userInfo,
    };
  }

  async logout(_userId: string) {
    return { success: true };
  }

  async getMe(user: CurrentUserContext) {
    const fullUser = await this.userRepo.findOne({ where: { id: user.id } });
    if (!fullUser) {
      throw new UnauthorizedException('用户不存在');
    }
    return this.buildUserInfo(fullUser, user.role as UserRole);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.userRepo.findOne({ where: { id: payload.sub } });
      if (!user || user.status !== CommonStatus.ACTIVE) {
        throw new UnauthorizedException('用户不存在或已停用');
      }

      const activeRole = (payload.role as UserRole) || user.role;
      const client = (payload.client as LoginClient) || 'pc';

      const accessToken = this.jwtService.sign(
        {
          sub: user.id,
          username: user.username,
          role: activeRole,
          client,
        },
        {
          secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
          expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES', '2h'),
        },
      );

      return { accessToken };
    } catch {
      throw new UnauthorizedException('refresh_token 无效或已过期');
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');

    if (dto.phone && dto.phone !== user.phone) {
      const exists = await this.userRepo.findOne({ where: { phone: dto.phone } });
      if (exists) throw new ConflictException('手机号已被使用');
      user.phone = dto.phone;
    }
    if (dto.realName !== undefined) user.realName = dto.realName;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.region !== undefined) user.region = dto.region;
    if (dto.avatar !== undefined) user.avatar = dto.avatar;

    await this.userRepo.save(user);
    return this.buildUserInfo(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');

    const ok = await bcrypt.compare(dto.oldPassword, user.password);
    if (!ok) throw new BadRequestException('原密码不正确');

    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
    return { success: true };
  }

  /** 根据登录端解析本次生效角色 */
  private async resolveActiveRole(user: User, client: LoginClient): Promise<UserRole> {
    const roles = getUserRoles(user);

    if (client === 'pc') {
      if (roles.includes(UserRole.SUPER_ADMIN)) return UserRole.SUPER_ADMIN;
      if (roles.includes(UserRole.SITE_MANAGER)) return UserRole.SITE_MANAGER;
      // 有正/副站长任职也可进管理端
      const managed = await this.siteScope.getManagedSiteIds(user.id);
      if (managed.length) return UserRole.SITE_MANAGER;
      throw new ForbiddenException(
        '该账号无管理端权限。请使用 H5 巡检端登录，或在用户管理中勾选「站长」角色',
      );
    }

    // H5 巡检端
    if (roles.includes(UserRole.INSPECTOR)) return UserRole.INSPECTOR;
    const memberSites = await this.siteScope.getInspectorSiteIds(user.id);
    if (memberSites.length) return UserRole.INSPECTOR;
    throw new ForbiddenException(
      '该账号无巡检端权限。请使用 PC 管理端登录，或在用户管理中勾选「巡检员」角色',
    );
  }

  private async generateTokens(user: User, activeRole: UserRole, client: LoginClient) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: activeRole,
      client,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES', '2h'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES', '7d'),
    });

    return { accessToken, refreshToken };
  }

  /** 构建对外用户信息；activeRole 为本次会话角色 */
  private async buildUserInfo(user: User, activeRole?: UserRole) {
    const roles = getUserRoles(user);
    const sessionRole = activeRole || user.role;
    const base = {
      id: user.id,
      username: user.username,
      realName: user.realName,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      role: sessionRole,
      roles,
      status: user.status,
      region: user.region,
      createdAt: user.createdAt,
    };

    let managedSites: Array<{
      id: string;
      name: string;
      code: string;
      province: string;
      city: string;
    }> = [];
    let siteMemberships: unknown[] = [];

    if (
      sessionRole === UserRole.SITE_MANAGER ||
      sessionRole === UserRole.SUPER_ADMIN ||
      userHasRole(user, UserRole.SITE_MANAGER)
    ) {
      const sites = await this.siteScope.getManagedSitesBrief(user.id);
      managedSites = sites.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        province: s.province,
        city: s.city,
      }));
    }

    if (sessionRole === UserRole.INSPECTOR || userHasRole(user, UserRole.INSPECTOR)) {
      const memberships = await this.siteMemberRepo.find({
        where: {
          userId: user.id,
          status: CommonStatus.ACTIVE,
          memberRole: SiteMemberRole.INSPECTOR,
        },
      });
      const siteIds = memberships.map((m) => m.siteId);
      const sites = siteIds.length
        ? await this.siteRepo.findBy({ id: In(siteIds) })
        : [];
      const siteMap = new Map(sites.map((s) => [s.id, s]));
      siteMemberships = memberships.map((m) => {
        const site = siteMap.get(m.siteId);
        return {
          id: m.id,
          siteId: m.siteId,
          status: m.status,
          joinedAt: m.joinedAt,
          memberRole: m.memberRole,
          site: site
            ? {
                id: site.id,
                name: site.name,
                code: site.code,
                province: site.province,
                city: site.city,
              }
            : null,
        };
      });
    }

    // 按当前会话角色裁剪返回：管理端会话突出 managedSites；巡检端突出 memberships
    if (sessionRole === UserRole.INSPECTOR) {
      // 多角色：站长/副站长登录 H5 时，所管站点也可进入巡检（无需再聘为自己）
      if (userHasRole(user, UserRole.SITE_MANAGER)) {
        const managed = await this.siteScope.getManagedSitesBrief(user.id);
        const seen = new Set(
          (siteMemberships as Array<{ siteId: string }>).map((m) => m.siteId),
        );
        for (const s of managed) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          (siteMemberships as unknown[]).push({
            id: `managed-${s.id}`,
            siteId: s.id,
            status: CommonStatus.ACTIVE,
            joinedAt: null,
            memberRole: SiteMemberRole.INSPECTOR,
            site: {
              id: s.id,
              name: s.name,
              code: s.code,
              province: s.province,
              city: s.city,
            },
          });
        }
      }
      return { ...base, managedSites: [], siteMemberships };
    }
    if (sessionRole === UserRole.SITE_MANAGER || sessionRole === UserRole.SUPER_ADMIN) {
      return { ...base, managedSites, siteMemberships: [] };
    }
    return { ...base, managedSites, siteMemberships };
  }
}
