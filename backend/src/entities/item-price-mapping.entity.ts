import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('item_price_mapping')
export class ItemPriceMapping {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'source_item_name', type: 'varchar', length: 255, unique: true })
  sourceItemName: string;
  @Column({ name: 'normalized_source', type: 'varchar', length: 255 }) normalizedSource: string;
  @Column({ name: 'target_item_code', type: 'varchar', length: 255 }) targetItemCode: string;
  @Column({ name: 'mapping_type', type: 'varchar', length: 16, default: 'manual' }) mappingType:
    'manual' | 'builtin';
  @Column({ type: 'numeric', precision: 5, scale: 4, default: 1 }) confidence: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status: 'active' | 'inactive';
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
