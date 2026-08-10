import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { InspectionTemplate, TemplateEntry, TemplateProductLine, Site, ServiceCase } from '../../entities';
import { UserRole, CommonStatus, CheckType, DeviceType } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  QueryTemplateDto,
  CloneTemplateDto,
} from './dto/template.dto';
import { rematchCasesForTemplate } from '../finance/services/demand-type-match';

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(InspectionTemplate)
    private readonly templateRepo: Repository<InspectionTemplate>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(ServiceCase)
    private readonly caseRepo: Repository<ServiceCase>,
  ) {}

  /** 模板列表：全局 + 网格自定义（按数据范围） */
  async findAll(query: QueryTemplateDto, currentUser: CurrentUserContext) {
    const qb = this.templateRepo.createQueryBuilder('tpl');

    if (query.deviceType) {
      qb.andWhere('tpl.device_type = :deviceType', { deviceType: query.deviceType });
    }

    const keyword = String(query.keyword || '').trim();
    if (keyword) {
      qb.andWhere('tpl.name ILIKE :keyword', { keyword: `%${keyword}%` });
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
          throw new ForbiddenException('无权查看该网格模板');
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
      // 工程师只读全局 + 自己加入网格的模板
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

  /** 创建服务类型：管理员与网格长均可维护全司统一类型 */
  async create(dto: CreateTemplateDto, currentUser: CurrentUserContext) {
    this.assertCanManageServiceTypes(currentUser);

    const isGlobal = true;
    const productLines = this.normalizeProductLines(dto.productLines || []);
    const entries = this.normalizeEntries(dto.entries || []);
    this.assertEntriesOrProductLines(entries, productLines);

    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('服务类型名称不能为空');
    await this.assertNameUnique(name);

    const tpl = this.templateRepo.create({
      name,
      deviceType: dto.deviceType || DeviceType.STRING_INVERTER,
      entries,
      productLines,
      isGlobal,
      siteId: null,
      assignMode: dto.assignMode === 'multi' ? 'multi' : 'single',
      unitLabel: '台',
      expenseEnabledDefault: !!dto.expenseEnabledDefault,
      version: 1,
    } as Partial<InspectionTemplate>);

    const saved = await this.templateRepo.save(tpl);
    const rematched = await rematchCasesForTemplate(this.caseRepo, this.templateRepo, saved);
    return { ...this.toSafe(saved), rematchedCases: rematched };
  }

  /**
   * 更新模板：仅检查项/产品线实质变更时 version+1
   * 进行中任务仍靠创建时 snapshot 隔离，与版本号无关
   */
  async update(id: string, dto: UpdateTemplateDto, currentUser: CurrentUserContext) {
    const tpl = await this.templateRepo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException('模板不存在');
    this.assertCanEdit(tpl, currentUser);

    const beforeFp = this.checklistFingerprint(tpl.productLines || [], tpl.entries || []);
    const oldTypeName = String(tpl.name || '').trim();
    const oldLineById = new Map(
      (tpl.productLines || [])
        .filter((p) => p?.id)
        .map((p) => [String(p.id), String(p.name || '').trim()] as const),
    );

    if (dto.entries) {
      tpl.entries = this.normalizeEntries(dto.entries);
    }
    if (dto.productLines !== undefined) {
      tpl.productLines = this.normalizeProductLines(dto.productLines);
    }
    if (dto.name !== undefined) {
      const name = String(dto.name || '').trim();
      if (!name) throw new BadRequestException('服务类型名称不能为空');
      await this.assertNameUnique(name, tpl.id);
      tpl.name = name;
    }
    if (dto.deviceType !== undefined) tpl.deviceType = dto.deviceType;

    tpl.isGlobal = true;
    tpl.siteId = null;
    if (dto.assignMode !== undefined) {
      tpl.assignMode = dto.assignMode === 'multi' ? 'multi' : 'single';
    }
    // 业务固定用「台」，不再开放自定义称呼
    tpl.unitLabel = '台';
    if (dto.expenseEnabledDefault !== undefined) {
      tpl.expenseEnabledDefault = !!dto.expenseEnabledDefault;
    }

    this.assertEntriesOrProductLines(tpl.entries || [], tpl.productLines || []);

    const afterFp = this.checklistFingerprint(tpl.productLines || [], tpl.entries || []);
    const versionChanged = beforeFp !== afterFp;
    if (versionChanged) {
      tpl.version = (tpl.version || 1) + 1;
    }
    const saved = await this.templateRepo.save(tpl);

    // 已绑定案例：服务类型名 / 产品线名跟着改（导入匹配后以配置为准）
    const newTypeName = String(saved.name || '').trim();
    const lineRenames: Array<{ from: string; to: string }> = [];
    for (const line of saved.productLines || []) {
      const idKey = String(line.id || '');
      const next = String(line.name || '').trim();
      const prev = oldLineById.get(idKey) || '';
      if (idKey && prev && next && prev !== next) {
        lineRenames.push({ from: prev, to: next });
      }
    }
    const syncedCases = await this.syncBoundCaseNames(saved.id, {
      oldTypeName,
      newTypeName,
      lineRenames,
    });

    const rematched = await rematchCasesForTemplate(this.caseRepo, this.templateRepo, saved);
    return {
      ...this.toSafe(saved),
      versionChanged,
      rematchedCases: rematched,
      syncedCases,
    };
  }

  /** 同步已绑定案例上的服务类型名、产品线名 */
  private async syncBoundCaseNames(
    templateId: string,
    opts: {
      oldTypeName: string;
      newTypeName: string;
      lineRenames: Array<{ from: string; to: string }>;
    },
  ): Promise<number> {
    const list = await this.caseRepo.find({ where: { taskTemplateId: templateId } });
    if (!list.length) return 0;
    let n = 0;
    const typeChanged =
      !!opts.oldTypeName && !!opts.newTypeName && opts.oldTypeName !== opts.newTypeName;
    for (const item of list) {
      let changed = false;
      if (typeChanged) {
        item.serviceType = opts.newTypeName.slice(0, 32);
        item.taskType = opts.newTypeName.slice(0, 128);
        changed = true;
      }
      const pl = String(item.productLine || '').trim();
      if (pl) {
        const hit = opts.lineRenames.find((r) => r.from === pl);
        if (hit) {
          item.productLine = hit.to.slice(0, 64);
          changed = true;
        }
      }
      if (changed) {
        await this.caseRepo.save(item);
        n += 1;
      }
    }
    return n;
  }

  async remove(id: string, currentUser: CurrentUserContext) {
    const tpl = await this.templateRepo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException('模板不存在');
    this.assertCanEdit(tpl, currentUser);

    const caseRows = await this.templateRepo.manager.query(
      `SELECT COUNT(*)::int AS cnt FROM service_case WHERE task_template_id = $1`,
      [id],
    );
    const caseCount = Number(caseRows?.[0]?.cnt || 0);
    if (caseCount > 0) {
      throw new BadRequestException(
        `该服务类型已被 ${caseCount} 个案例引用，无法删除。请先在案例中改绑服务类型，或清空相关案例后再删。`,
      );
    }

    await this.templateRepo.remove(tpl);
    return { success: true };
  }

  /** 克隆全局/其他模板到指定网格 */
  async clone(id: string, dto: CloneTemplateDto, currentUser: CurrentUserContext) {
    const source = await this.templateRepo.findOne({ where: { id } });
    if (!source) throw new NotFoundException('源模板不存在');
    this.assertSiteAccess(dto.siteId, currentUser);
    await this.ensureSite(dto.siteId);

    const baseName = `${source.name}（网格副本）`;
    let cloneName = baseName;
    let i = 2;
    while (!(await this.isNameAvailable(cloneName))) {
      cloneName = `${baseName}${i}`;
      i += 1;
      if (i > 50) throw new BadRequestException('无法生成不重名的网格副本名称');
    }

    const cloned = this.templateRepo.create({
      name: cloneName,
      deviceType: source.deviceType,
      entries: this.normalizeEntries(source.entries),
      productLines: this.normalizeProductLines(source.productLines || []),
      isGlobal: false,
      siteId: dto.siteId,
      assignMode: source.assignMode || 'single',
      unitLabel: '台',
      expenseEnabledDefault: !!source.expenseEnabledDefault,
      version: 1,
    } as Partial<InspectionTemplate>);

    const saved = await this.templateRepo.save(cloned);
    return this.toSafe(saved);
  }

  /**
   * 解析任务可用模板：优先网格自定义，否则全局
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

  private normalizeProductLines(
    lines: Array<{
      id?: string;
      name: string;
      entries?: Array<{
        id?: string;
        name: string;
        description: string;
        isRequired: boolean;
        order: number;
        samplePhotos: string[];
        checkType: CheckType;
        isOptionalModule?: boolean;
      }>;
    }>,
  ): TemplateProductLine[] {
    const seen = new Set<string>();
    const result: TemplateProductLine[] = [];
    for (const line of lines || []) {
      const name = String(line.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException(`产品线「${name}」重复`);
      }
      seen.add(key);
      const entries = this.normalizeEntries(line.entries || []);
      if (!entries.length) {
        throw new BadRequestException(`产品线「${name}」至少需要一个检查条目`);
      }
      result.push({
        id: line.id || uuidv4(),
        name: name.slice(0, 64),
        entries,
      });
    }
    return result;
  }

  private assertEntriesOrProductLines(
    entries: TemplateEntry[],
    productLines: TemplateProductLine[],
  ) {
    if (!productLines.length) {
      throw new BadRequestException('请至少配置一条产品线（如地面-组串式）');
    }
    // entries 仅作兼容旧数据回退，可不填
    void entries;
  }

  /** 检查项/产品线内容指纹：用于判断是否需要递增版本 */
  private checklistFingerprint(
    productLines: TemplateProductLine[],
    entries: TemplateEntry[],
  ): string {
    const normEntry = (e: TemplateEntry) => ({
      id: e.id,
      name: String(e.name || '').trim(),
      description: String(e.description || '').trim(),
      isRequired: !!e.isRequired,
      order: e.order ?? 0,
      samplePhotos: [...(e.samplePhotos || [])].map(String).sort(),
      checkType: e.checkType || CheckType.PHOTO,
      isOptionalModule: !!e.isOptionalModule,
    });
    const payload = {
      productLines: (productLines || [])
        .map((p) => ({
          id: p.id,
          name: String(p.name || '').trim(),
          entries: (p.entries || [])
            .map(normEntry)
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      entries: (entries || [])
        .map(normEntry)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    };
    return JSON.stringify(payload);
  }

  private async ensureSite(siteId: string) {
    const site = await this.siteRepo.findOne({
      where: { id: siteId, deletedAt: IsNull() },
    });
    if (!site || site.status !== CommonStatus.ACTIVE) {
      throw new NotFoundException('网格不存在或已停用');
    }
  }

  private assertSiteAccess(siteId: string, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) return;
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权操作该网格模板');
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

  private assertCanManageServiceTypes(currentUser: CurrentUserContext) {
    if (
      currentUser.role === UserRole.SUPER_ADMIN ||
      currentUser.role === UserRole.SITE_MANAGER
    ) {
      return;
    }
    throw new ForbiddenException('无权维护服务类型');
  }

  private assertCanEdit(tpl: InspectionTemplate, currentUser: CurrentUserContext) {
    if (tpl.isGlobal) {
      this.assertCanManageServiceTypes(currentUser);
      return;
    }
    if (!tpl.siteId) {
      throw new ForbiddenException('模板数据异常');
    }
    this.assertSiteAccess(tpl.siteId, currentUser);
  }

  private async isNameAvailable(name: string, excludeId?: string): Promise<boolean> {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;
    const qb = this.templateRepo
      .createQueryBuilder('tpl')
      .where('TRIM(tpl.name) = :name', { name: trimmed });
    if (excludeId) qb.andWhere('tpl.id <> :excludeId', { excludeId });
    const count = await qb.getCount();
    return count === 0;
  }

  private async assertNameUnique(name: string, excludeId?: string) {
    if (!(await this.isNameAvailable(name, excludeId))) {
      throw new BadRequestException(`服务类型「${String(name).trim()}」已存在，名称不可重复`);
    }
  }

  private toSafe(tpl: InspectionTemplate) {
    return {
      id: tpl.id,
      name: tpl.name,
      deviceType: tpl.deviceType,
      entries: tpl.entries || [],
      productLines: Array.isArray(tpl.productLines) ? tpl.productLines : [],
      isGlobal: tpl.isGlobal,
      siteId: tpl.siteId,
      assignMode: tpl.assignMode || 'single',
      unitLabel: '台',
      expenseEnabledDefault: !!tpl.expenseEnabledDefault,
      version: tpl.version,
      createdAt: tpl.createdAt,
    };
  }
}
