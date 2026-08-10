import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CaseAssignmentStatus = 'assigned' | 'working' | 'done' | 'withdrawn';

@Entity('case_assignment')
@Index(['serviceCaseId', 'inspectorId'], { unique: true })
export class CaseAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'service_case_id', type: 'bigint' }) serviceCaseId: string;
  @Column({ name: 'inspector_id', type: 'uuid' }) inspectorId: string;
  @Column({ name: 'assign_by', type: 'uuid', nullable: true }) assignBy: string | null;
  @Column({ name: 'assign_time', type: 'timestamptz', nullable: true }) assignTime: Date | null;
  @Column({ type: 'varchar', length: 16, default: 'assigned' }) status: CaseAssignmentStatus;
  @Column({ name: 'completed_units', type: 'int', default: 0 }) completedUnits: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
