import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities';
import { CommonStatus, UserRole } from '../../../common/enums';
import { JwtPayload, CurrentUserContext, LoginClient } from '../../../common/interfaces';
import { SiteScopeService } from '../../site/site-scope.service';
import { getUserRoles } from '../../../common/utils/user-roles';

/** JWT 策略：按 token 中的 activeRole 加载数据范围 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly siteScope: SiteScopeService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<CurrentUserContext> {
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });

    if (!user || user.status !== CommonStatus.ACTIVE) {
      throw new UnauthorizedException('用户不存在或已停用');
    }

    const roles = getUserRoles(user);
    const activeRole = (payload.role as UserRole) || user.role;
    const client = payload.client as LoginClient | undefined;

    let managedSiteIds: string[] = [];
    let memberSiteIds: string[] = [];

    if (activeRole === UserRole.SITE_MANAGER || activeRole === UserRole.SUPER_ADMIN) {
      managedSiteIds = await this.siteScope.getManagedSiteIds(user.id);
    }

    if (activeRole === UserRole.INSPECTOR) {
      memberSiteIds = await this.siteScope.getInspectorSiteIds(user.id);
      // 多角色站长在 H5：所管站点一并纳入巡检数据范围
      if (roles.includes(UserRole.SITE_MANAGER)) {
        const managed = await this.siteScope.getManagedSiteIds(user.id);
        memberSiteIds = [...new Set([...memberSiteIds, ...managed])];
      }
    }

    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      phone: user.phone,
      role: activeRole,
      roles,
      status: user.status,
      client,
      managedSiteIds,
      memberSiteIds,
      scopedSiteIds: [],
    };
  }
}
