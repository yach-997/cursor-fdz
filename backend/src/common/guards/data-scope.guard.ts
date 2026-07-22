import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '../enums';
import { CurrentUserContext } from '../interfaces';

/**
 * 数据范围守卫（数据隔离中间件）
 * 规则：
 * 1. super_admin：跳过所有 site_id 过滤，全平台可见
 * 2. site_manager：查询自动限定在自己管理的站点；传 site_id 须属于该站长
 * 3. inspector：只能查自己加入的站点；任务/记录进一步在业务层按本人过滤
 */
@Injectable()
export class DataScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserContext;

    if (!user) {
      return true; // 公开接口无用户，交由 JwtAuthGuard 处理
    }

    // 超级管理员：不限制站点范围
    if (user.role === UserRole.SUPER_ADMIN) {
      user.scopedSiteIds = [];
      request.dataScope = {
        isSuperAdmin: true,
        siteIds: [],
      };
      return true;
    }

    // 站长：限定管理站点
    if (user.role === UserRole.SITE_MANAGER) {
      const managedIds = user.managedSiteIds || [];
      user.scopedSiteIds = managedIds;
      request.dataScope = {
        isSuperAdmin: false,
        siteIds: managedIds,
      };

      // 若 query/body 明确传 siteId，必须属于当前用户数据范围
      const explicitSiteId =
        request.query?.site_id ||
        request.query?.siteId ||
        request.body?.site_id ||
        request.body?.siteId;

      if (explicitSiteId && !managedIds.includes(explicitSiteId)) {
        throw new ForbiddenException('无权访问该站点数据');
      }

      return true;
    }

    // 工程师：限定加入的站点
    if (user.role === UserRole.INSPECTOR) {
      const memberIds = user.memberSiteIds || [];
      user.scopedSiteIds = memberIds;
      request.dataScope = {
        isSuperAdmin: false,
        siteIds: memberIds,
        inspectorId: user.id,
      };

      const explicitSiteId =
        request.query?.site_id ||
        request.query?.siteId ||
        request.body?.site_id ||
        request.body?.siteId;

      if (explicitSiteId && !memberIds.includes(explicitSiteId)) {
        throw new ForbiddenException('无权访问该站点数据');
      }

      return true;
    }

    throw new ForbiddenException('未知角色，拒绝访问');
  }
}
