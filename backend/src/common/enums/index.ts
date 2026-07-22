/** 用户角色枚举 */
export enum UserRole {
  /** 超级管理员 */
  SUPER_ADMIN = 'super_admin',
  /** 站长（可作为正站长/副站长任职，具体以站点任命为准） */
  SITE_MANAGER = 'site_manager',
  /** 工程师（可同时加入多个站点） */
  INSPECTOR = 'inspector',
}

/** 站点成员任职类型（正站长仍记在 sites.manager_id） */
export enum SiteMemberRole {
  /** 副站长 */
  DEPUTY_MANAGER = 'deputy_manager',
  /** 工程师 */
  INSPECTOR = 'inspector',
}

/** 通用启用/停用状态 */
export enum CommonStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/** 设备类型 */
export enum DeviceType {
  /** 组串逆变器 */
  STRING_INVERTER = 'string_inverter',
  /** 集中式逆变器 */
  CENTRAL_INVERTER = 'central_inverter',
  /** 储能设备 */
  ENERGY_STORAGE = 'energy_storage',
}

/** 设备状态 */
export enum DeviceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance',
}

/** 巡检任务状态 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ARCHIVED = 'archived',
}

/** 巡检记录状态 */
export enum RecordStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ARCHIVED = 'archived',
}

/** 检查类型 */
export enum CheckType {
  PHOTO = 'photo',
  TEXT = 'text',
}

/** AI/人工判定结果 */
export enum CheckResult {
  PASS = 'pass',
  FAIL = 'fail',
  PENDING = 'pending',
  ERROR = 'error',
}
