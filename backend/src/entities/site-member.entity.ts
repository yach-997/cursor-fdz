import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { CommonStatus, SiteMemberRole } from '../common/enums';
import { Site } from './site.entity';
import { User } from './user.entity';

/** 站点成员：副站长 / 巡检员（一人可属多站） */
@Entity('site_members')
@Unique(['siteId', 'userId'])
export class SiteMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'member_role',
    type: 'enum',
    enum: SiteMemberRole,
    default: SiteMemberRole.INSPECTOR,
  })
  memberRole: SiteMemberRole;

  @Column({
    type: 'enum',
    enum: CommonStatus,
    default: CommonStatus.ACTIVE,
  })
  status: CommonStatus;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;

  @ManyToOne(() => Site, (site) => site.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site: Site;

  @ManyToOne(() => User, (user) => user.siteMemberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
