import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';

/**
 * 费用数据权限。
 * 归属区域仅为人员档案/统计元数据，不再作为 ACL。
 * 网格长权限以「管理的站点」为准：可跨省管人、跨站派单。
 */
@Injectable()
export class FinanceScopeService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  /** 可选元数据；未配置不报错，也不再用于强制过滤 */
  async region(user: CurrentUserContext): Promise<string | null> {
    if (user.role === UserRole.SUPER_ADMIN) return null;
    const current = await this.users.findOne({
      where: { id: user.id },
      select: { id: true, region: true },
    });
    return current?.region || null;
  }

  /** @deprecated 区域不再作为费用 ACL；保留空实现避免旧调用报错 */
  async assertRegion(_user: CurrentUserContext, _targetRegion: string | null) {
    void _user;
    void _targetRegion;
  }

  /** 案例访问：管理员全量；网格长可看未挂站案例，或已挂到自己管理站点的案例 */
  assertCaseAccess(
    user: CurrentUserContext,
    serviceCase: { siteId?: string | null },
  ) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (user.role !== UserRole.SITE_MANAGER) {
      throw new ForbiddenException('无权访问费用案例');
    }
    if (serviceCase.siteId && !user.managedSiteIds?.includes(serviceCase.siteId)) {
      throw new ForbiddenException('无权操作其他站点的案例');
    }
  }
}
