import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('assessment')
@Index(['month', 'userId'], { unique: true })
export class Assessment {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ type: 'varchar', length: 7 }) month: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'user_role', type: 'varchar', length: 24 }) userRole: string;
  @Column({ name: 'internal_score', type: 'numeric', precision: 5, scale: 2, default: 0 }) internalScore: string;
  @Column({ name: 'sungrow_score', type: 'numeric', precision: 5, scale: 2, default: 0 }) sungrowScore: string;
  @Column({ name: 'total_score', type: 'numeric', precision: 5, scale: 2, default: 0 }) totalScore: string;
  @Column({ name: 'rank_group', type: 'varchar', length: 24 }) rankGroup: 'station_manager' | 'inspector';
  @Column({ name: 'rank_result', type: 'varchar', length: 24, nullable: true }) rankResult: string | null;
  @Column({ name: 'reward_amount', type: 'numeric', precision: 12, scale: 2, default: 0 }) rewardAmount: string;
  @Column({ name: 'tool_subsidy', type: 'numeric', precision: 12, scale: 2, default: 0 }) toolSubsidy: string;
  @Column({ name: 'other_subsidy', type: 'numeric', precision: 12, scale: 2, default: 0 }) otherSubsidy: string;
  @Column({ name: 'subsidy_remark', type: 'text', nullable: true }) subsidyRemark: string | null;
  @Column({ name: 'correction_amount', type: 'numeric', precision: 12, scale: 2, default: 0 }) correctionAmount: string;
  @Column({ name: 'correction_reason', type: 'text', nullable: true }) correctionReason: string | null;
  /** 专业指标事件扣罚合计（正数表示从月结中扣减） */
  @Column({ name: 'event_penalty', type: 'numeric', precision: 12, scale: 2, default: 0 }) eventPenalty: string;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
