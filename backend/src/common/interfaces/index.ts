/** 统一 API 响应结构 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

/** 分页数据结构 */
export interface PaginatedData<T> {
  list: T[];
  total: number;
  page: number;
  limit: number;
}

/** 登录客户端：PC 管理端 / H5 巡检端 */
export type LoginClient = 'pc' | 'h5';

/** JWT Payload */
export interface JwtPayload {
  sub: string;
  username: string;
  /** 本次登录生效角色（由登录端决定） */
  role: string;
  client?: LoginClient;
}

/** 当前登录用户上下文（附加数据范围） */
export interface CurrentUserContext {
  id: string;
  username: string;
  realName: string;
  phone: string;
  /** 本次会话生效角色 */
  role: string;
  /** 账号具备的全部角色 */
  roles: string[];
  status: string;
  client?: LoginClient;
  /** 站长/副站长管理的站点 ID 列表 */
  managedSiteIds: string[];
  /** 工程师加入的站点 ID 列表 */
  memberSiteIds: string[];
  /** 数据范围可用的站点 ID（由 DataScope 计算） */
  scopedSiteIds: string[];
}
