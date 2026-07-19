import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('po_order')
export class PoOrder {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'po_no', type: 'varchar', length: 64, unique: true }) poNo: string;
  @Column({ name: 'gsp_case_no', type: 'varchar', length: 32 }) gspCaseNo: string;
  @Column({ name: 'service_case_id', type: 'bigint', nullable: true }) serviceCaseId: string | null;
  @Column({ name: 'po_total_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  poTotalAmount: string;
  @Column({ name: 'demand_date', type: 'date', nullable: true }) demandDate: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) demander: string | null;
  @Column({ name: 'demand_type', type: 'varchar', length: 32, nullable: true }) demandType:
    string | null;
  @Column({ name: 'product_line', type: 'varchar', length: 64, nullable: true }) productLine:
    string | null;
  @Column({ name: 'product_model', type: 'varchar', length: 64, nullable: true }) productModel:
    string | null;
  @Column({ name: 'product_qty', type: 'numeric', precision: 12, scale: 2, nullable: true })
  productQty: string | null;
  @Column({ name: 'fault_phenomenon', type: 'text', nullable: true }) faultPhenomenon:
    string | null;
  @Column({ name: 'fault_level', type: 'varchar', length: 64, nullable: true }) faultLevel:
    string | null;
  @Column({ name: 'duration_req', type: 'varchar', length: 64, nullable: true }) durationReq:
    string | null;
  @Column({ name: 'demand_desc', type: 'text', nullable: true }) demandDesc: string | null;
  @Column({ name: 'project_area', type: 'varchar', length: 64, nullable: true }) projectArea:
    string | null;
  @Column({ name: 'project_country', type: 'varchar', length: 32, nullable: true }) projectCountry:
    string | null;
  @Column({ name: 'project_region', type: 'varchar', length: 64, nullable: true }) projectRegion:
    string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) province: string | null;
  @Column({ name: 'project_name', type: 'varchar', length: 128, nullable: true }) projectName:
    string | null;
  @Column({ name: 'project_scene', type: 'varchar', length: 32, nullable: true }) projectScene:
    string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) submitter: string | null;
  @Column({ name: 'dingtalk_created_at', type: 'timestamptz', nullable: true })
  dingtalkCreatedAt: Date | null;
  @Column({ name: 'dingtalk_updated_at', type: 'timestamptz', nullable: true })
  dingtalkUpdatedAt: Date | null;
  @Column({ name: 'match_status', type: 'varchar', length: 16, default: 'pending' }) matchStatus:
    'matched' | 'pending';
  @Column({ name: 'import_batch_id', type: 'bigint', nullable: true }) importBatchId: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
