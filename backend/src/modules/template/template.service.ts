import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { InspectionTemplate, TemplateEntry, Site } from '../../entities';
import { UserRole, CommonStatus, CheckType } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  QueryTemplateDto,
  CloneTemplateDto,
} from './dto/template.dto';

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(InspectionTemplate)
    private readonly templateRepo: Repository<InspectionTemplate>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
  ) {}

  /** 模板列表：全局 + 站点自定义（按数据范围） */
  async findAll(query: QueryTemplateDto, currentUser: CurrentUserContext) {
    const qb = this.templateRepo.createQueryBuilder('tpl');

    if (query.deviceType) {
      qb.andWhere('tpl.device_type = :deviceType', { deviceType: query.deviceType });
    }

    if (currentUser.role === UserRole.SUPER_ADMIN) {
      if (query.siteId) {
        qb.andWhere('(tpl.is_global = true OR tpl.site_id = :siteId)', {
          siteId: query.siteId,
        });
      }
    } else if (currentUser.role === UserRole.SITE_MANAGER) {
      const siteIds = currentUser.managedSiteIds || [];
      if (query.siteId) {
        if (!siteIds.includes(query.siteId)) {
          throw new ForbiddenException('无权查看该站点模板');
        }
        qb.andWhere('(tpl.is_global = true OR tpl.site_id = :siteId)', {
          siteId: query.siteId,
        });
      } else if (siteIds.length) {
        qb.andWhere('(tpl.is_global = true OR tpl.site_id IN (:...siteIds))', {
          siteIds,
        });
      } else {
        qb.andWhere('tpl.is_global = true');
      }
    } else {
      // 工程师只读全局 + 自己加入站点的模板
      const siteIds = currentUser.memberSiteIds || [];
      if (siteIds.length) {
        qb.andWhere('(tpl.is_global = true OR tpl.site_id IN (:...siteIds))', {
          siteIds,
        });
      } else {
        qb.andWhere('tpl.is_global = true');
      }
    }

    qb.orderBy('tpl.isGlobal', 'DESC').addOrderBy('tpl.createdAt', 'DESC');
    const list = await qb.getMany();
    return list.map((t) => this.toSafe(t));
  }

  async findOne(id: string, currentUser: CurrentUserContext) {
    const tpl = await this.templateRepo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException('模板不存在');
    this.assertCanView(tpl, currentUser);
    return this.toSafe(tpl);
  }

  /** 创建模板：全局仅超管；站点模板站长可建自己站点的 */
  async create(dto: CreateTemplateDto, currentUser: CurrentUserContext) {
    if (dto.isGlobal) {
      if (currentUser.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('仅超级管理员可创建全局模板');
      }
    } else {
      if (!dto.siteId) {
        throw new BadRequestException('站点自定义模板必须指定 siteId');
      }
      this.assertSiteAccess(dto.siteId, currentUser);
      await this.ensureSite(dto.siteId);
    }

    const entries = this.normalizeEntries(dto.entries);
    const tpl = this.templateRepo.create({
      name: dto.name,
      deviceType: dto.deviceType,
      entries,
      isGlobal: dto.isGlobal,
      siteId: dto.isGlobal ? null : dto.siteId || null,
      version: 1,
    } as Partial<InspectionTemplate>);

    const saved = await this.templateRepo.save(tpl);
    return this.toSafe(saved);
  }

  /**
   * 更新模板：version+1
   * 只影响新任务，进行中任务保持原模板快照
   */
  async update(id: string, dto: UpdateTemplateDto, currentUser: CurrentUserContext) {
    const tpl = await this.templateRepo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException('模板不存在');
    this.assertCanEdit(tpl, currentUser);

    if (dto.entries) {
      tpl.entries = this.normalizeEntries(dto.entries);
    }
    if (dto.name !== undefined) tpl.name = dto.name;
    if (dto.deviceType !== undefined) tpl.deviceType = dto.deviceType;

    const nextIsGlobal = dto.isGlobal ?? tpl.isGlobal;
    const nextSiteId = nextIsGlobal ? null : (dto.siteId ?? tpl.siteId);
    if (nextIsGlobal) {
      if (currentUser.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('仅超级管理员可将模板设为全局');
      }
    } else {
      if (!nextSiteId) {
        throw new BadRequestException('站点自定义模板必须指定 siteId');
      }
      this.assertSiteAccess(nextSiteId, currentUser);
      await this.ensureSite(nextSiteId);
    }
    tpl.isGlobal = nextIsGlobal;
    tpl.siteId = nextSiteId;

    tpl.version = (tpl.version || 1) + 1;
    const saved = await this.templateRepo.save(tpl);
    return this.toSafe(saved);
  }

  async remove(id: string, currentUser: CurrentUserContext) {
    const tpl = await this.templateRepo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException('模板不存在');
    this.assertCanEdit(tpl, currentUser);
    await this.templateRepo.remove(tpl);
    return { success: true };
  }

  /** 克隆全局/其他模板到指定站点 */
  async clone(id: string, dto: CloneTemplateDto, currentUser: CurrentUserContext) {
    const source = await this.templateRepo.findOne({ where: { id } });
    if (!source) throw new NotFoundException('源模板不存在');
    this.assertSiteAccess(dto.siteId, currentUser);
    await this.ensureSite(dto.siteId);

    const cloned = this.templateRepo.create({
      name: `${source.name}（站点副本）`,
      deviceType: source.deviceType,
      entries: this.normalizeEntries(source.entries),
      isGlobal: false,
      siteId: dto.siteId,
      version: 1,
    } as Partial<InspectionTemplate>);

    const saved = await this.templateRepo.save(cloned);
    return this.toSafe(saved);
  }

  /**
   * 解析任务可用模板：优先站点自定义，否则全局
   */
  async resolveForDevice(
    deviceType: string,
    siteId: string,
  ): Promise<InspectionTemplate | null> {
    const siteList = await this.templateRepo.find({
      where: { deviceType: deviceType as any, siteId, isGlobal: false },
      order: { version: 'DESC' },
      take: 1,
    });
    if (siteList[0]) return siteList[0];

    const globalList = await this.templateRepo.find({
      where: { deviceType: deviceType as any, isGlobal: true, siteId: IsNull() },
      order: { version: 'DESC' },
      take: 1,
    });
    return globalList[0] || null;
  }

  private normalizeEntries(
    entries: Array<{
      id?: string;
      name: string;
      description: string;
      isRequired: boolean;
      order: number;
      samplePhotos: string[];
      checkType: CheckType;
      isOptionalModule?: boolean;
    }>,
  ): TemplateEntry[] {
    return entries
      .map((e, index) => ({
        id: e.id || uuidv4(),
        name: e.name,
        description: e.description || '',
        isRequired: !!e.isRequired,
        order: e.order ?? index,
        samplePhotos: e.samplePhotos || [],
        checkType: e.checkType || CheckType.PHOTO,
        isOptionalModule: e.isOptionalModule,
      }))
      .sort((a, b) => a.order - b.order);
  }

  private async ensureSite(siteId: string) {
    const site = await this.siteRepo.findOne({
      where: { id: siteId, deletedAt: IsNull() },
    });
    if (!site || site.status !== CommonStatus.ACTIVE) {
      throw new NotFoundException('站点不存在或已停用');
    }
  }

  private assertSiteAccess(siteId: string, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权操作该站点模板');
      }
      return;
    }
    throw new ForbiddenException('无权操作模板');
  }

  private assertCanView(tpl: InspectionTemplate, currentUser: CurrentUserContext) {
    if (tpl.isGlobal) return;
    if (!tpl.siteId) return;
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(tpl.siteId)) {
        throw new ForbiddenException('无权查看该模板');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (!currentUser.memberSiteIds.includes(tpl.siteId)) {
        throw new ForbiddenException('无权查看该模板');
      }
    }
  }

  private assertCanEdit(tpl: InspectionTemplate, currentUser: CurrentUserContext) {
    if (tpl.isGlobal) {
      if (currentUser.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('仅超级管理员可编辑全局模板');
      }
      return;
    }
    if (!tpl.siteId) {
      throw new ForbiddenException('模板数据异常');
    }
    this.assertSiteAccess(tpl.siteId, currentUser);
  }

  private toSafe(tpl: InspectionTemplate) {
    return {
      id: tpl.id,
      name: tpl.name,
      deviceType: tpl.deviceType,
      entries: tpl.entries,
      isGlobal: tpl.isGlobal,
      siteId: tpl.siteId,
      version: tpl.version,
      createdAt: tpl.createdAt,
    };
  }
}
