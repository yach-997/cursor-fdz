import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TaskStatus } from '../common/enums';
import { Site } from './site.entity';
import { Device } from './device.entity';
import { User } from './user.entity';
import { TemplateEntry } from './inspection-template.entity';

/** 巡检任务实体 */
@Entity('inspection_tasks')
export class InspectionTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ name: 'task_name' })
  taskName: string;

  @Column({ name: 'inspector_id', type: 'uuid' })
  inspectorId: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.PENDING,
  })
  status: TaskStatus;

  @Column({ name: 'planned_date', type: 'date', nullable: true })
  plannedDate: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'ai_enabled', default: true })
  aiEnabled: boolean;

  /** 创建任务时的模板快照，进行中任务不受模板修改影响 */
  @Column({ name: 'template_snapshot', type: 'jsonb', nullable: true })
  templateSnapshot: TemplateEntry[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Site)
  @JoinColumn({ name: 'site_id' })
  site: Site;

  @ManyToOne(() => Device)
  @JoinColumn({ name: 'device_id' })
  device: Device;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'inspector_id' })
  inspector: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;
}
