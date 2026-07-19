import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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
  @Column({ name: 'service_type', type: 'varchar', length: 32, nullable: true }) serviceType:
    string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) creator: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) province: string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) city: string | null;
  @Column({ name: 'site_desc', type: 'text', nullable: true }) siteDesc: string | null;
  @Column({ type: 'varchar', length: 16, default: 'south_china' }) region: FinanceRegion;
  @Column({ type: 'varchar', length: 20, default: 'pending_assign' }) status: ServiceCaseStatus;
  @Column({ name: 'inspector_id', type: 'uuid', nullable: true }) inspectorId: string | null;
  @Column({ name: 'assign_by', type: 'uuid', nullable: true }) assignBy: string | null;
  @Column({ name: 'assign_time', type: 'timestamptz', nullable: true }) assignTime: Date | null;
  @Column({ name: 'finish_time', type: 'timestamptz', nullable: true }) finishTime: Date | null;
  @Column({ name: 'import_batch_id', type: 'bigint', nullable: true }) importBatchId: string | null;
  @Column({ type: 'int', default: 1 }) version: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
