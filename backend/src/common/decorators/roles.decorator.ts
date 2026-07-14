import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums';

export const ROLES_KEY = 'roles';

/** 角色装饰器：标记接口允许的角色 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
