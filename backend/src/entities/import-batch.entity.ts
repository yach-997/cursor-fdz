import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FinanceImportType = 'gsp_case' | 'po_order' | 'settle_price' | 'perf_price';

@Entity('import_batch')
export class ImportBatch {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'import_type', type: 'varchar', length: 32 }) importType: FinanceImportType;
  @Column({ name: 'file_name', type: 'varchar', length: 255 }) fileName: string;
  @Column({ name: 'total_rows', type: 'int', default: 0 }) totalRows: number;
  @Column({ name: 'success_rows', type: 'int', default: 0 }) successRows: number;
  @Column({ name: 'fail_rows', type: 'int', default: 0 }) failRows: number;
  @Column({ name: 'fail_detail', type: 'jsonb', default: () => "'[]'" }) failDetail: Array<{
    row: number;
    reason: string;
  }>;
  @Column({ name: 'operator_id', type: 'uuid', nullable: true }) operatorId: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
