import { UserRole } from '../enums';
import { User } from '../../entities/user.entity';

/**
 * QueryBuilder 条件：用户是否具备某角色。
 * - 勿用 PG jsonb `?`（TypeORM 会当参数占位符）
 * - 列名用双引号包裹，避免 TypeORM 把属性路径解析成「.roles」
 */
export function qbUserHasRole(
  alias: string,
  role: UserRole,
  paramPrefix = 'role',
): { sql: string; params: Record<string, string> } {
  const jsonKey = `${paramPrefix}Json`;
  const roleKey = `${paramPrefix}Val`;
  // alias 保持 TypeORM 表别名；列名用蛇形/实体库列：roles、role
  return {
    sql: `("${alias}"."roles" @> CAST(:${jsonKey} AS jsonb) OR ((COALESCE(jsonb_array_length("${alias}"."roles"), 0) = 0) AND "${alias}"."role" = :${roleKey}))`,
    params: {
      [jsonKey]: JSON.stringify([role]),
      [roleKey]: role,
    },
  };
}

/** 读取用户全部角色（兼容旧单 role 字段） */
export function getUserRoles(user: Pick<User, 'role' | 'roles'>): UserRole[] {
  const fromArr = (user.roles || []).filter(Boolean) as UserRole[];
  if (fromArr.length) {
    return [...new Set(fromArr)];
  }
  return user.role ? [user.role] : [];
}

export function userHasRole(
  user: Pick<User, 'role' | 'roles'>,
  role: UserRole,
): boolean {
  return getUserRoles(user).includes(role);
}

/** 展示用主角色优先级 */
export function pickPrimaryRole(roles: UserRole[]): UserRole {
  if (roles.includes(UserRole.SUPER_ADMIN)) return UserRole.SUPER_ADMIN;
  if (roles.includes(UserRole.SITE_MANAGER)) return UserRole.SITE_MANAGER;
  if (roles.includes(UserRole.INSPECTOR)) return UserRole.INSPECTOR;
  return UserRole.INSPECTOR;
}

/** 合并角色并同步 legacy role 字段 */
export function applyUserRoles(user: User, roles: UserRole[]): UserRole[] {
  const next = [...new Set(roles.filter(Boolean))];
  if (!next.length) {
    throw new Error('至少保留一个角色');
  }
  user.roles = next;
  user.role = pickPrimaryRole(next);
  return next;
}

export function ensureUserHasRole(user: User, role: UserRole): void {
  const roles = getUserRoles(user);
  if (!roles.includes(role)) {
    applyUserRoles(user, [...roles, role]);
  } else if (!user.roles?.length) {
    applyUserRoles(user, roles);
  }
}
