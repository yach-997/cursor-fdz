import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DeviceType, RecordStatus, CheckResult } from '../common/enums';
import { InspectionTask } from './inspection-task.entity';
import { User } from './user.entity';

/** AI 分析结果结构 */
export interface AiResult {
  status: CheckResult;
  confidence: number;
  reason: string;
}

/** 巡检记录条目结构（JSONB） */
export interface RecordEntry {
  templateEntryId: string;
  photos: string[];
  aiResult: AiResult;
  manualResult: CheckResult.PASS | CheckResult.FAIL | CheckResult.PENDING;
  finalResult: CheckResult.PASS | CheckResult.FAIL | null;
  remark: string;
}

/** 驳回原因结构（可标注需返工的检查项） */
export interface RejectReason {
  reason: string;
  rejectedAt: Date;
  /** 需返工的 templateEntryId 列表；空则表示整体驳回 */
  entryIds?: string[];
}

/** 操作追溯事件（提交 / 驳回 / 重提 / 通过） */
export interface AuditTrailEvent {
  action:
    | 'submitted'
    | 'resubmitted'
    | 'auto_approved'
    | 'approved'
    | 'rejected'
    | 'reopened';
  at: string;
  by?: string;
  byName?: string;
  reason?: string;
  entryIds?: string[];
  summary?: string;
}

/** 巡检记录实体 */
@Entity('inspection_records')
export class InspectionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({
    name: 'device_type',
    type: 'enum',
    enum: DeviceType,
  })
  deviceType: DeviceType;

  @Column({ type: 'jsonb' })
  entries: RecordEntry[];

  @Column({ name: 'report_photos', type: 'jsonb', nullable: true })
  reportPhotos: string[] | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    default: RecordStatus.DRAFT,
  })
  status: RecordStatus;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'reject_reason', type: 'jsonb', nullable: true })
  rejectReason: RejectReason | null;

  /** 全流程操作链条，用于历史追溯 */
  @Column({ name: 'audit_trail', type: 'jsonb', default: () => "'[]'" })
  auditTrail: AuditTrailEvent[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => InspectionTask)
  @JoinColumn({ name: 'task_id' })
  task: InspectionTask;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approver: User;
}
