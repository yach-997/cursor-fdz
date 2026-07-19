import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('change_log')
export class ChangeLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'entity_type', type: 'varchar', length: 32 }) entityType: string;
  @Column({ name: 'entity_id', type: 'varchar', length: 64 }) entityId: string;
  @Column({ type: 'varchar', length: 64 }) field: string;
  @Column({ name: 'old_value', type: 'text', nullable: true }) oldValue: string | null;
  @Column({ name: 'new_value', type: 'text', nullable: true }) newValue: string | null;
  @Column({ name: 'operator_id', type: 'uuid', nullable: true }) operatorId: string | null;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
