import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';

@Injectable()
export class FinanceScopeService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}
  async region(user: CurrentUserContext): Promise<string | null> {
    if (user.role === UserRole.SUPER_ADMIN) return null;
    const current = await this.users.findOne({
      where: { id: user.id },
      select: { id: true, region: true },
    });
    if (!current?.region) throw new ForbiddenException('当前账号未配置归属区域，请联系管理员');
    return current.region;
  }
  async assertRegion(user: CurrentUserContext, targetRegion: string | null) {
    const scoped = await this.region(user);
    if (scoped && scoped !== targetRegion)
      throw new ForbiddenException('无权访问其他区域的费用数据');
  }
}
