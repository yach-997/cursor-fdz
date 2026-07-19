import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('price_library')
export class PriceLibrary {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'price_type', type: 'varchar', length: 16 }) priceType: 'settle' | 'perf';
  @Column({ name: 'item_code', type: 'varchar', length: 255 }) itemCode: string;
  @Column({ name: 'item_name', type: 'varchar', length: 255 }) itemName: string;
  @Column({ name: 'item_desc', type: 'text', nullable: true }) itemDesc: string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) unit: string | null;
  @Column({ name: 'product_model', type: 'varchar', length: 64, nullable: true }) productModel:
    string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) scene: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) region: string | null;
  @Column({ name: 'coop_type', type: 'varchar', length: 16, nullable: true }) coopType:
    string | null;
  @Column({ name: 'work_hours', type: 'numeric', precision: 12, scale: 2, nullable: true })
  workHours: string | null;
  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 2 }) unitPrice: string;
  @Column({ name: 'effective_date', type: 'date' }) effectiveDate: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status: 'active' | 'inactive';
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @Column({ name: 'change_remark', type: 'text', nullable: true }) changeRemark: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
