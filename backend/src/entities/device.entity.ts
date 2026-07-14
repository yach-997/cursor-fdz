import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DeviceType, DeviceStatus } from '../common/enums';
import { Site } from './site.entity';

/** 设备实体 */
@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId: string;

  /** 设备序列号，全局唯一 */
  @Column({ name: 'serial_number', unique: true })
  serialNumber: string;

  @Column({
    name: 'device_type',
    type: 'enum',
    enum: DeviceType,
  })
  deviceType: DeviceType;

  @Column({ nullable: true })
  model: string;

  @Column({ nullable: true })
  manufacturer: string;

  @Column({ name: 'install_date', type: 'date', nullable: true })
  installDate: Date | null;

  @Column({
    type: 'enum',
    enum: DeviceStatus,
    default: DeviceStatus.ACTIVE,
  })
  status: DeviceStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Site, (site) => site.devices, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'site_id' })
  site: Site;
}
