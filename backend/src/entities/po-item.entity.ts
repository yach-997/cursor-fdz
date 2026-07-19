import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('po_item')
export class PoItem {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'po_id', type: 'bigint' }) poId: string;
  @Column({ name: 'source_row', type: 'int', nullable: true }) sourceRow: number | null;
  @Column({ name: 'item_category', type: 'varchar', length: 16 }) itemCategory:
    'special' | 'general';
  @Column({ name: 'item_code', type: 'varchar', length: 255 }) itemCode: string;
  @Column({ name: 'item_name', type: 'varchar', length: 255 }) itemName: string;
  @Column({ name: 'item_desc', type: 'text', nullable: true }) itemDesc: string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) unit: string | null;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 }) qty: string;
  @Column({ name: 'settle_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  settlePrice: string | null;
  @Column({ name: 'perf_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  perfPrice: string | null;
  @Column({ name: 'item_revenue', type: 'numeric', precision: 12, scale: 2, default: 0 })
  itemRevenue: string;
  @Column({ name: 'item_perf', type: 'numeric', precision: 12, scale: 2, default: 0 })
  itemPerf: string;
  @Column({ name: 'price_status', type: 'varchar', length: 20, default: 'pending_price' })
  priceStatus: 'ok' | 'pending_price' | 'ignored';
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
