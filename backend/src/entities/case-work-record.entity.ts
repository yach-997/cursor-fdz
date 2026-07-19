import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('case_work_record')
export class CaseWorkRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'service_case_id', type: 'bigint', unique: true }) serviceCaseId: string;
  @Column({ name: 'gsp_case_no', type: 'varchar', length: 32, unique: true }) gspCaseNo: string;
  @Column({ name: 'inspector_id', type: 'uuid' }) inspectorId: string;
  @Column({ type: 'jsonb', default: () => "'{}'" }) workload: Record<string, unknown>;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 }) mileage: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 }) expenses: string;
  @Column({ name: 'expense_note', type: 'text', nullable: true }) expenseNote: string | null;
  @Column({ name: 'mileage_screenshot_urls', type: 'jsonb', default: () => "'[]'" })
  mileageScreenshotUrls: string[];
  @Column({ name: 'work_note', type: 'text', nullable: true }) workNote: string | null;
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true }) acceptedAt: Date | null;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
