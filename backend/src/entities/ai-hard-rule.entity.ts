import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AiHardRuleCode =
  | 'ac_side'
  | 'grounding'
  | 'dc_side'
  | 'fault_record'
  | 'sungrow'
  | 'mount_fix';

export type AiHardRuleMatchMode = 'title_exact' | 'title_includes' | 'criteria_includes';

export type AiHardRuleEnforceMode = 'strict' | 'normal' | 'off';

/** AI 专项硬规则：超管可配，分析时插入提示词并控制二次校验强度 */
@Entity('ai_hard_rules')
export class AiHardRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 稳定编码，程序按 code 取规则 */
  @Column({ type: 'varchar', length: 32, unique: true })
  code: AiHardRuleCode | string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** 标题精确 / 标题包含 / 全文包含 */
  @Column({ name: 'match_mode', type: 'varchar', length: 32, default: 'title_includes' })
  matchMode: AiHardRuleMatchMode | string;

  /** 匹配关键词，多个用 | 分隔 */
  @Column({ name: 'match_pattern', type: 'varchar', length: 255 })
  matchPattern: string;

  /** 插入模型的硬规则正文 */
  @Column({ name: 'prompt_text', type: 'text' })
  promptText: string;

  /** 期望 JSON 结构说明（可选，写入主提示 schema 区时可参考） */
  @Column({ name: 'json_schema_hint', type: 'text', nullable: true })
  jsonSchemaHint: string | null;

  @Column({ default: true })
  enabled: boolean;

  /**
   * strict=启用二次复核；normal=主提示硬规则；off=不插硬规则也不做二次复核
   */
  @Column({ name: 'enforce_mode', type: 'varchar', length: 16, default: 'strict' })
  enforceMode: AiHardRuleEnforceMode | string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'change_note', type: 'text', nullable: true })
  changeNote: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
