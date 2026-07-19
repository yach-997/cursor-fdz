import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('monthly_settlement')
@Index(['month', 'userId'], { unique: true })
export class MonthlySettlement {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ type: 'varchar', length: 7 }) month: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'perf_total', type: 'numeric', precision: 12, scale: 2, default: 0 }) perfTotal: string;
  @Column({ name: 'reward_total', type: 'numeric', precision: 12, scale: 2, default: 0 }) rewardTotal: string;
  @Column({ name: 'subsidy_total', type: 'numeric', precision: 12, scale: 2, default: 0 }) subsidyTotal: string;
  @Column({ name: 'correction_total', type: 'numeric', precision: 12, scale: 2, default: 0 }) correctionTotal: string;
  @Column({ name: 'final_amount', type: 'numeric', precision: 12, scale: 2, default: 0 }) finalAmount: string;
  @Column({ type: 'varchar', length: 16, default: 'draft' }) status: 'draft' | 'corrected' | 'locked';
  @Column({ name: 'locked_by', type: 'uuid', nullable: true }) lockedBy: string | null;
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true }) lockedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
