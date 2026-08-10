import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CaseExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/**
 * 行程报销：按作业台（work_unit）一条。
 * 起止里程+导航嵌入作业；费用为工程师自算申报金额，审核可核定为其他金额。
 */
@Entity('case_expense_claim')
@Index(['serviceCaseId'])
@Index(['inspectorId'])
@Index(['workUnitId'])
export class CaseExpenseClaim {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'service_case_id', type: 'bigint' }) serviceCaseId: string;
  /** 挂载作业台；旧数据可为空 */
  @Column({ name: 'work_unit_id', type: 'bigint', nullable: true }) workUnitId: string | null;
  @Column({ name: 'inspector_id', type: 'uuid' }) inspectorId: string;

  /** 结算用金额：审核通过后为核定金额，通过前等于申报金额 */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 }) amount: string;
  /** 工程师申报金额（审核改核定后仍保留） */
  @Column({ name: 'claim_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  claimAmount: string;
  /** @deprecated 兼容旧分项，新流程不再使用 */
  @Column({ name: 'toll_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  tollAmount: string;
  @Column({ name: 'fuel_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  fuelAmount: string;
  @Column({ name: 'other_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  otherAmount: string;

  @Column({ type: 'text', nullable: true }) note: string | null;

  /** 费用凭证（批量）；里程/导航图另存在 start/end 字段 */
  @Column({ name: 'voucher_urls', type: 'jsonb', default: () => "'[]'" }) voucherUrls: string[];
  /** @deprecated */
  @Column({ name: 'toll_voucher_urls', type: 'jsonb', default: () => "'[]'" })
  tollVoucherUrls: string[];
  @Column({ name: 'fuel_voucher_urls', type: 'jsonb', default: () => "'[]'" })
  fuelVoucherUrls: string[];
  @Column({ name: 'other_voucher_urls', type: 'jsonb', default: () => "'[]'" })
  otherVoucherUrls: string[];

  @Column({ name: 'start_odometer_url', type: 'text', nullable: true })
  startOdometerUrl: string | null;
  /** @deprecated 兼容单张；新流程用 startNavUrls，首张同步到此字段 */
  @Column({ name: 'start_nav_url', type: 'text', nullable: true }) startNavUrl: string | null;
  @Column({ name: 'start_nav_urls', type: 'jsonb', default: () => "'[]'" }) startNavUrls: string[];
  @Column({ name: 'start_mileage', type: 'numeric', precision: 12, scale: 1, nullable: true })
  startMileage: string | null;

  @Column({ name: 'end_odometer_url', type: 'text', nullable: true })
  endOdometerUrl: string | null;
  /** @deprecated 兼容单张；新流程用 endNavUrls */
  @Column({ name: 'end_nav_url', type: 'text', nullable: true }) endNavUrl: string | null;
  @Column({ name: 'end_nav_urls', type: 'jsonb', default: () => "'[]'" }) endNavUrls: string[];
  @Column({ name: 'end_mileage', type: 'numeric', precision: 12, scale: 1, nullable: true })
  endMileage: string | null;
  /** 结束−开始，仅审核参考 */
  @Column({ name: 'mileage_km', type: 'numeric', precision: 12, scale: 1, nullable: true })
  mileageKm: string | null;

  /**
   * 开工时选择「无行程」：管理员可见；结束时不强制里程/费用。
   * 若填了开始里程则 tripSkipped=false，结束必须补齐。
   */
  @Column({ name: 'trip_skipped', type: 'boolean', default: false })
  tripSkipped: boolean;

  @Column({ type: 'varchar', length: 16, default: 'draft' }) status: CaseExpenseStatus;
  @Column({ name: 'review_by', type: 'uuid', nullable: true }) reviewBy: string | null;
  @Column({ name: 'review_at', type: 'timestamptz', nullable: true }) reviewAt: Date | null;
  @Column({ name: 'review_note', type: 'text', nullable: true }) reviewNote: string | null;
  @Column({ type: 'varchar', length: 7, nullable: true }) month: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
