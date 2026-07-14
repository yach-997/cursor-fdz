import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums';
import { CurrentUserContext } from '../interfaces';

/** 角色守卫：校验当前用户是否具备接口要求的角色 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 未标注 @Roles 则放行（仍需 JWT）
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserContext;

    if (!user) {
      throw new ForbiddenException('无权限访问');
    }

    if (!requiredRoles.includes(user.role as UserRole)) {
      throw new ForbiddenException('当前角色无权执行此操作');
    }

    return true;
  }
}
