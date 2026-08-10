import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CaseWorkUnitStatus =
  | 'open'
  | 'claimed'
  | 'submitted'
  | 'completed'
  | 'cancelled';

@Entity('case_work_unit')
@Index(['serviceCaseId', 'seq'], { unique: true })
export class CaseWorkUnit {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'service_case_id', type: 'bigint' }) serviceCaseId: string;
  @Column({ type: 'int' }) seq: number;
  @Column({ type: 'varchar', length: 128, nullable: true }) title: string | null;
  @Column({ type: 'varchar', length: 16, default: 'open' }) status: CaseWorkUnitStatus;
  @Column({ name: 'inspector_id', type: 'uuid', nullable: true }) inspectorId: string | null;
  @Column({ name: 'inspection_task_id', type: 'uuid', nullable: true }) inspectionTaskId: string | null;
  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true }) claimedAt: Date | null;
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ name: 'submit_count', type: 'int', default: 0 }) submitCount: number;
  /** 现场识别/确认的设备序列号 */
  @Column({ name: 'device_serial', type: 'varchar', length: 128, nullable: true })
  deviceSerial: string | null;
  @Column({ name: 'serial_photo_url', type: 'text', nullable: true })
  serialPhotoUrl: string | null;
  @Column({ name: 'serial_confirmed_at', type: 'timestamptz', nullable: true })
  serialConfirmedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
