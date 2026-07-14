import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { DeviceType, CheckType } from '../common/enums';

/** 巡检模板条目结构（JSONB） */
export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  /** 是否必填 */
  isRequired: boolean;
  order: number;
  /** 样本照片 URL 列表 */
  samplePhotos: string[];
  checkType: CheckType;
  /** 可选模块（如中压变压器） */
  isOptionalModule?: boolean;
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

  @Column({ type: 'jsonb' })
  entries: TemplateEntry[];

  /** true=管理员全局模板 */
  @Column({ name: 'is_global', default: true })
  isGlobal: boolean;

  /** null=全局，有值=站点自定义 */
  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string | null;

  @Column({ default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
