import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkTaskType } from '../common/enums';

export type FinanceRegion = 'south_china' | 'yunnan';
export type ServiceCaseStatus =
  | 'pending_assign'
  | 'assigned'
  | 'working'
  | 'finished'
  | 'settle_review'
  | 'settled'
  | 'month_locked';

@Entity('service_case')
export class ServiceCase {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'gsp_case_no', type: 'varchar', length: 32, unique: true }) gspCaseNo: string;
  @Column({ name: 'project_name', type: 'varchar', length: 128 }) projectName: string;
  /** 对应 PO「需求类型」（如巡检/故障恢复/整改） */
  @Column({ name: 'service_type', type: 'varchar', length: 32, nullable: true }) serviceType:
    string | null;
  /** 产品线（对应 PO「产品线」：地面-组串式 / 地面-集中式…） */
  @Column({ name: 'product_line', type: 'varchar', length: 64, nullable: true }) productLine:
    string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) creator: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) province: string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) city: string | null;
  @Column({ name: 'site_desc', type: 'text', nullable: true }) siteDesc: string | null;
  /** 归属网格（管理员分配） */
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId: string | null;
  /** 需求类型展示名（来自需求类型模板名称；兼容旧值 inspection/service） */
  @Column({ name: 'task_type', type: 'varchar', length: 128, nullable: true }) taskType:
    WorkTaskType | string | null;
  /** 关联的需求类型模板（inspection_templates.id） */
  @Column({ name: 'task_template_id', type: 'uuid', nullable: true }) taskTemplateId: string | null;
  /** single=一人一单；multi=多人共享执行单元 */
  @Column({ name: 'assign_mode', type: 'varchar', length: 16, default: 'single' })
  assignMode: 'single' | 'multi';
  /** 计划执行单元数（多人模式如 10 个网格） */
  @Column({ name: 'planned_units', type: 'int', default: 1 }) plannedUnits: number;
  @Column({ name: 'completed_units', type: 'int', default: 0 }) completedUnits: number;
  @Column({ name: 'expense_enabled', type: 'boolean', default: false }) expenseEnabled: boolean;
  @Column({ name: 'unit_label', type: 'varchar', length: 32, default: '台' }) unitLabel: string;
  @Column({ type: 'varchar', length: 16, default: 'south_china' }) region: FinanceRegion;
  @Column({ type: 'varchar', length: 20, default: 'pending_assign' }) status: ServiceCaseStatus;
  /** 主工程师（兼容旧逻辑；多人以 case_assignment 为准） */
  @Column({ name: 'inspector_id', type: 'uuid', nullable: true }) inspectorId: string | null;
  @Column({ name: 'assign_by', type: 'uuid', nullable: true }) assignBy: string | null;
  @Column({ name: 'assign_time', type: 'timestamptz', nullable: true }) assignTime: Date | null;
  @Column({ name: 'finish_time', type: 'timestamptz', nullable: true }) finishTime: Date | null;
  @Column({ name: 'import_batch_id', type: 'bigint', nullable: true }) importBatchId: string | null;
  @Column({ type: 'int', default: 1 }) version: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
