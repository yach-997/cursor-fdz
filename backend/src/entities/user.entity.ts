import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserRole, CommonStatus } from '../common/enums';
import { Site } from './site.entity';
import { SiteMember } from './site-member.entity';

/** 用户实体 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  /** bcrypt 加密后的密码 */
  @Column()
  password: string;

  @Column({ name: 'real_name' })
  realName: string;

  @Column({ unique: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  avatar: string;

  /**
   * 兼容旧版：主角色（与 roles 同步，取优先级最高者）
   * 实际鉴权以登录端 activeRole + roles 为准
   */
  @Column({
    type: 'enum',
    enum: UserRole,
  })
  role: UserRole;

  /** 一账号多角色，如同时具备站长 + 工程师 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  roles: UserRole[];

  @Column({
    type: 'enum',
    enum: CommonStatus,
    default: CommonStatus.ACTIVE,
  })
  status: CommonStatus;

  @Column({ nullable: true })
  region: string;

  /** 费用结算归属单位 */
  @Column({ name: 'org_unit', type: 'varchar', length: 64, nullable: true })
  orgUnit: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** 作为站长管理的站点 */
  @OneToMany(() => Site, (site) => site.manager)
  managedSites: Site[];

  /** 作为工程师加入的站点关联 */
  @OneToMany(() => SiteMember, (member) => member.user)
  siteMemberships: SiteMember[];
}
