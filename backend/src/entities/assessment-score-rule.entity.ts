import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('assessment_score_rule')
export class AssessmentScoreRule {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  /** 全公司共用一套规则 */
  @Column({ type: 'jsonb', default: () => "'[]'" }) items: Array<Record<string, unknown>>;
  @Column({ type: 'int', default: 1 }) version: number;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
