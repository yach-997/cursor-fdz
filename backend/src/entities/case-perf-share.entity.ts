import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('case_perf_share')
@Index(['serviceCaseId', 'inspectorId'], { unique: true })
export class CasePerfShare {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'service_case_id', type: 'bigint' }) serviceCaseId: string;
  @Column({ name: 'inspector_id', type: 'uuid' }) inspectorId: string;
  @Column({ name: 'completed_units', type: 'int', default: 0 }) completedUnits: number;
  @Column({ name: 'share_ratio', type: 'numeric', precision: 8, scale: 6, default: 0 }) shareRatio: string;
  @Column({ name: 'perf_amount', type: 'numeric', precision: 12, scale: 2, default: 0 }) perfAmount: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
