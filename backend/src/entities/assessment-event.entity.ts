import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('assessment_event')
@Index(['month', 'userId'])
export class AssessmentEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ type: 'varchar', length: 7 }) month: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'category', type: 'varchar', length: 64 }) category: string;
  @Column({ name: 'content', type: 'text' }) content: string;
  @Column({ type: 'varchar', length: 16, default: '次' }) unit: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 1 }) qty: string;
  /** 标准单价；自定义项可为空，以 amount 为准 */
  @Column({ name: 'unit_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  unitAmount: string | null;
  /** 本条扣罚金额（正数表示扣减） */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 }) amount: string;
  @Column({ type: 'text', nullable: true }) remark: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
