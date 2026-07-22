import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { CommonStatus } from '../common/enums';
import { User } from './user.entity';
import { SiteMember } from './site-member.entity';
import { Device } from './device.entity';

/** 站点实体 */
@Entity('sites')
export class Site {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  code: string;

  @Column()
  province: string;

  @Column()
  city: string;

  @Column()
  district: string;

  @Column()
  address: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  /** 工程师允许拍照/提交的站点围栏半径（米） */
  @Column({ name: 'inspection_radius_meters', type: 'int', default: 500 })
  inspectionRadiusMeters: number;

  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId: string | null;

  @Column({
    type: 'enum',
    enum: CommonStatus,
    default: CommonStatus.ACTIVE,
  })
  status: CommonStatus;

  /** 软删除标记 */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.managedSites, { nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: User | null;

  @OneToMany(() => SiteMember, (member) => member.site)
  members: SiteMember[];

  @OneToMany(() => Device, (device) => device.site)
  devices: Device[];
}
