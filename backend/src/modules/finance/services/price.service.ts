import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceLibrary } from '../../../entities';
import { CurrentUserContext } from '../../../common/interfaces';
import { ChangeLogService } from './change-log.service';
import { CreatePriceDto, PriceQueryDto, UpdatePriceDto } from '../dto/finance.dto';
import { UserRole } from '../../../common/enums';
import { assertFinanceClearAllowed } from '../../../common/utils/finance-clear-guard';

@Injectable()
export class PriceService {
  constructor(
    @InjectRepository(PriceLibrary) private readonly repo: Repository<PriceLibrary>,
    private readonly logs: ChangeLogService,
  ) {}
  async list(query: PriceQueryDto, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN && query.type === 'perf') {
      throw new ForbiddenException('站长无权查看绩效单价库');
    }
    if (user.role !== UserRole.SUPER_ADMIN) query.type = 'settle';
    const page = query.page || 1,
      limit = query.limit || 10;
    const qb = this.repo.createQueryBuilder('p');
    if (query.type) qb.andWhere('p.price_type=:type', { type: query.type });
    if (query.scene) qb.andWhere('p.scene=:scene', { scene: query.scene });
    if (query.region) qb.andWhere('p.region=:region', { region: query.region });
    if (query.keyword)
      qb.andWhere('(p.item_code ILIKE :kw OR p.item_name ILIKE :kw)', { kw: `%${query.keyword}%` });
    const [list, total] = await qb
      .orderBy('p.updated_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { list, total, page, limit };
  }
  async create(dto: CreatePriceDto, user: CurrentUserContext) {
    return this.repo.save(
      this.repo.create({
        ...dto,
        unitPrice: Number(dto.unitPrice).toFixed(2),
        workHours: dto.workHours == null ? null : Number(dto.workHours).toFixed(2),
        effectiveDate: dto.effectiveDate || new Date().toISOString().slice(0, 10),
        status: 'active',
        createdBy: user.id,
        changeRemark: dto.changeRemark || null,
      }),
    );
  }
  async update(id: string, dto: UpdatePriceDto, user: CurrentUserContext) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('价格记录不存在');
    const old = { ...item };
    Object.assign(item, {
      ...dto,
      unitPrice: Number(dto.unitPrice).toFixed(2),
      workHours: dto.workHours == null ? null : Number(dto.workHours).toFixed(2),
      effectiveDate: dto.effectiveDate || item.effectiveDate,
      itemDesc: dto.itemDesc || null,
      unit: dto.unit || null,
      productModel: dto.productModel || null,
      scene: dto.scene || null,
      region: dto.region || null,
      coopType: dto.coopType || null,
      changeRemark: dto.changeRemark || null,
    });
    const saved = await this.repo.save(item);
    await this.logs.write(
      'price_library',
      id,
      'price_update',
      old,
      saved,
      user.id,
      dto.changeRemark || '价格调整',
    );
    return saved;
  }
  history(id: string) {
    return this.logs.list('price_library', id);
  }

  async remove(id: string, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('仅管理员可删除价格');
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('价格记录不存在');
    await this.repo.remove(item);
    await this.logs.write(
      'price_library',
      id,
      'price_delete',
      item,
      null,
      user.id,
      `删除${item.priceType === 'perf' ? '内部绩效价' : '甲方结算价'}：${item.itemCode}`,
    );
    return { id, deleted: true };
  }

  async clear(type: 'settle' | 'perf', confirm: string | undefined, user: CurrentUserContext) {
    if (user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('仅管理员可清空价格库');
    assertFinanceClearAllowed(confirm);
    if (type !== 'settle' && type !== 'perf') {
      throw new ForbiddenException('请指定要清空的价格类型');
    }
    const result = await this.repo.delete({ priceType: type });
    const deleted = result.affected || 0;
    await this.logs.write(
      'price_library',
      type,
      'price_clear',
      { priceType: type },
      { deleted },
      user.id,
      `清空全部${type === 'perf' ? '内部绩效价' : '甲方结算价'}，共 ${deleted} 条`,
    );
    return { priceType: type, deleted };
  }
}
