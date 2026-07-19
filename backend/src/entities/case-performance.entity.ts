import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('case_performance')
export class CasePerformance {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'service_case_id', type: 'bigint', unique: true }) serviceCaseId: string;
  @Column({ name: 'gsp_case_no', type: 'varchar', length: 32, unique: true }) gspCaseNo: string;
  @Column({ name: 'inspector_id', type: 'uuid', nullable: true }) inspectorId: string | null;
  @Column({ name: 'perf_base', type: 'numeric', precision: 12, scale: 2, default: 0 })
  perfBase: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 }) deduction: string;
  @Column({ name: 'deduction_reason', type: 'text', nullable: true }) deductionReason:
    string | null;
  @Column({ name: 'deduct_by', type: 'uuid', nullable: true }) deductBy: string | null;
  @Column({ name: 'deduction_status', type: 'varchar', length: 16, default: 'none' })
  deductionStatus: 'none' | 'pending' | 'approved' | 'rejected';
  @Column({ name: 'deduction_review_by', type: 'uuid', nullable: true })
  deductionReviewBy: string | null;
  @Column({ name: 'deduction_review_time', type: 'timestamptz', nullable: true })
  deductionReviewTime: Date | null;
  @Column({ name: 'perf_final', type: 'numeric', precision: 12, scale: 2, default: 0 })
  perfFinal: string;
  @Column({ name: 'case_revenue', type: 'numeric', precision: 12, scale: 2, default: 0 })
  caseRevenue: string;
  @Column({ name: 'review_status', type: 'varchar', length: 16, default: 'pending' }) reviewStatus:
    'pending' | 'approved' | 'rejected';
  @Column({ name: 'reviewer_id', type: 'uuid', nullable: true }) reviewerId: string | null;
  @Column({ name: 'review_time', type: 'timestamptz', nullable: true }) reviewTime: Date | null;
  @Column({ name: 'review_comment', type: 'text', nullable: true }) reviewComment: string | null;
  @Column({ type: 'varchar', length: 7, nullable: true }) month: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
