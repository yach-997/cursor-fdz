import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 系统品牌配置（单行：id=default） */
@Entity('system_branding')
export class SystemBranding {
  @PrimaryColumn({ type: 'varchar', length: 32, default: 'default' })
  id: string;

  @Column({ name: 'system_name', type: 'varchar', length: 64, default: '阳光运维系统' })
  systemName: string;

  @Column({ name: 'subtitle', type: 'varchar', length: 64, nullable: true, default: '阳光运维平台' })
  subtitle: string | null;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
