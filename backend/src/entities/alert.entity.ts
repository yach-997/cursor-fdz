import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 预警类型 */
export enum AlertType {
  HIGH_FAIL_RATE = 'high_fail_rate',
  OVERDUE_TASK = 'overdue_task',
  PENDING_AUDIT = 'pending_audit',
  DATA_ARCHIVED = 'data_archived',
}

/** 预警严重程度 */
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

/** 预警状态 */
export enum AlertStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

/** 站点预警阈值配置 */
@Entity('alert_configs')
export class AlertConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'site_id', type: 'uuid', unique: true })
  siteId: string;

  /** 不合格率阈值（%），超过则预警 */
  @Column({ name: 'fail_rate_threshold', type: 'float', default: 25 })
  failRateThreshold: number;

  /** 任务超期天数（planned_date 距今） */
  @Column({ name: 'overdue_days', type: 'int', default: 3 })
  overdueDays: number;

  @Column({ default: true })
  enabled: boolean;

  /** 通知邮箱列表 */
  @Column({ name: 'notify_emails', type: 'jsonb', nullable: true })
  notifyEmails: string[] | null;

  /** Webhook 通知地址（企业微信/钉钉等） */
  @Column({ name: 'webhook_url', type: 'varchar', length: 512, nullable: true })
  webhookUrl: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** 预警记录 */
@Entity('alert_records')
export class AlertRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId: string;

  @Column({ name: 'alert_type', type: 'enum', enum: AlertType })
  alertType: AlertType;

  @Column({ type: 'enum', enum: AlertSeverity, default: AlertSeverity.WARNING })
  severity: AlertSeverity;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'enum', enum: AlertStatus, default: AlertStatus.OPEN })
  status: AlertStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
