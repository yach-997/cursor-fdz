import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { DeviceType, CheckType } from '../common/enums';

/** @deprecated 兼容旧数据；新逻辑用 aiEnabled + checkType */
export type TemplateEntryKind = 'check' | 'record';

/** 巡检模板条目结构（JSONB） */
export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  /** 是否必填 */
  isRequired: boolean;
  order: number;
  /** 样本照片 URL（拍照且启用 AI 时用于对比） */
  samplePhotos: string[];
  /** photo=现场拍照；text=只填文字 */
  checkType: CheckType;
  /**
   * 是否对该条目做 AI 分析。
   * 缺省：旧 entryKind=record → false；checkType=text → false；否则 true。
   */
  aiEnabled?: boolean;
  /** @deprecated 请用 aiEnabled */
  entryKind?: TemplateEntryKind;
  /** @deprecated 已废弃，忽略 */
  isOptionalModule?: boolean;
}

/** 服务类型下的产品线变体（一套独立检查条目） */
export interface TemplateProductLine {
  id: string;
  name: string;
  entries: TemplateEntry[];
  /** @deprecated 产品线级检查/记录已废弃，忽略 */
  entryMode?: TemplateEntryKind;
}

/** 是否对该模板条目启用 AI（含旧数据推断） */
export function resolveEntryAiEnabled(entry: {
  aiEnabled?: boolean;
  entryKind?: string;
  checkType?: CheckType | string;
}): boolean {
  if (entry.aiEnabled === true) return true;
  if (entry.aiEnabled === false) return false;
  if (entry.entryKind === 'record') return false;
  if (entry.entryKind === 'check') return true;
  if (entry.checkType === CheckType.TEXT || entry.checkType === 'text') return false;
  return true;
}

/** 巡检模板实体 */
@Entity('inspection_templates')
export class InspectionTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({
    name: 'device_type',
    type: 'enum',
    enum: DeviceType,
  })
  deviceType: DeviceType;

  /**
   * 默认/通用检查条目。
   * 未配置 productLines 时使用；已配置产品线时仅作兼容回退。
   */
  @Column({ type: 'jsonb' })
  entries: TemplateEntry[];

  /** 产品线变体（故障恢复 → 组串/集中/充电…） */
  @Column({ name: 'product_lines', type: 'jsonb', default: () => "'[]'" })
  productLines: TemplateProductLine[];

  /** true=管理员全局模板 */
  @Column({ name: 'is_global', default: true })
  isGlobal: boolean;

  /** null=全局，有值=网格自定义 */
  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string | null;

  /** single | multi */
  @Column({ name: 'assign_mode', type: 'varchar', length: 16, default: 'single' })
  assignMode: 'single' | 'multi';

  /** 多人模式单元名称，如网格/整改项 */
  @Column({ name: 'unit_label', type: 'varchar', length: 32, default: '台' })
  unitLabel: string;

  /** 新建案例时是否默认开启报销 */
  @Column({ name: 'expense_enabled_default', type: 'boolean', default: false })
  expenseEnabledDefault: boolean;

  @Column({ default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
