import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiHardRule,
  AiHardRuleCode,
  AiHardRuleEnforceMode,
} from '../../entities/ai-hard-rule.entity';
import { CurrentUserContext } from '../../common/interfaces';
import { HARD_RULE_DEFAULTS, getHardRuleDefault } from './hard-rule.defaults';
import { UpdateHardRuleDto } from './dto/hard-rule.dto';

@Injectable()
export class HardRuleService implements OnModuleInit {
  private readonly logger = new Logger(HardRuleService.name);
  private cache = new Map<string, AiHardRule>();
  private ready: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(AiHardRule)
    private readonly repo: Repository<AiHardRule>,
  ) {}

  onModuleInit() {
    this.ready = this.ensureSchemaAndDefaults().catch((err) => {
      this.logger.warn(`AI 硬规则初始化失败，将使用代码默认值: ${(err as Error).message}`);
    });
  }

  async list() {
    await this.ready;
    await this.refreshCache();
    return [...this.cache.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async findByCode(code: string) {
    await this.ready;
    const hit = this.cache.get(code) || (await this.repo.findOne({ where: { code } }));
    if (!hit) throw new NotFoundException('硬规则不存在');
    return hit;
  }

  /**
   * 取生效提示词：禁用 → 空串；库无/失败 → fallback；启用 → 库正文。
   */
  async getEffectivePrompt(code: AiHardRuleCode | string, fallback: string): Promise<string> {
    try {
      await this.ready;
      if (!this.cache.size) await this.refreshCache();
      const rule = this.cache.get(code);
      if (!rule) return fallback;
      if (!rule.enabled || rule.enforceMode === 'off') return '';
      return String(rule.promptText || '').trim() || fallback;
    } catch {
      return fallback;
    }
  }

  async getEnforceMode(code: AiHardRuleCode | string): Promise<AiHardRuleEnforceMode> {
    try {
      await this.ready;
      if (!this.cache.size) await this.refreshCache();
      const rule = this.cache.get(code);
      if (!rule) return 'strict';
      if (!rule.enabled) return 'off';
      const mode = String(rule.enforceMode || 'strict');
      if (mode === 'off' || mode === 'normal' || mode === 'strict') return mode;
      return 'strict';
    } catch {
      return 'strict';
    }
  }

  async update(code: string, dto: UpdateHardRuleDto, user: CurrentUserContext) {
    await this.ready;
    const rule = await this.repo.findOne({ where: { code } });
    if (!rule) throw new NotFoundException('硬规则不存在');

    if (dto.name !== undefined) rule.name = dto.name.trim();
    if (dto.matchMode !== undefined) rule.matchMode = dto.matchMode;
    if (dto.matchPattern !== undefined) rule.matchPattern = dto.matchPattern.trim();
    if (dto.promptText !== undefined) rule.promptText = dto.promptText.trim();
    if (dto.jsonSchemaHint !== undefined) {
      rule.jsonSchemaHint = dto.jsonSchemaHint ? String(dto.jsonSchemaHint).trim() : null;
    }
    if (dto.enabled !== undefined) rule.enabled = dto.enabled;
    if (dto.enforceMode !== undefined) rule.enforceMode = dto.enforceMode;
    rule.changeNote = dto.changeNote.trim();
    rule.updatedBy = user.id;
    rule.version = Number(rule.version || 1) + 1;

    const saved = await this.repo.save(rule);
    this.cache.set(saved.code, saved);
    this.logger.log(`硬规则已更新: ${saved.code} v${saved.version} by ${user.username || user.id}`);
    return saved;
  }

  async resetToDefault(code: string, changeNote: string, user: CurrentUserContext) {
    const def = getHardRuleDefault(code);
    if (!def) throw new NotFoundException('无此内置默认规则');
    return this.update(
      code,
      {
        name: def.name,
        matchMode: def.matchMode,
        matchPattern: def.matchPattern,
        promptText: def.promptText,
        jsonSchemaHint: def.jsonSchemaHint,
        enabled: true,
        enforceMode: def.enforceMode,
        changeNote: changeNote || '恢复内置默认硬规则',
      },
      user,
    );
  }

  private async refreshCache() {
    const rows = await this.repo.find();
    this.cache.clear();
    for (const row of rows) this.cache.set(row.code, row);
  }

  private async ensureSchemaAndDefaults() {
    await this.repo.query(`
      CREATE TABLE IF NOT EXISTS ai_hard_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(32) NOT NULL UNIQUE,
        name varchar(64) NOT NULL,
        match_mode varchar(32) NOT NULL DEFAULT 'title_includes',
        match_pattern varchar(255) NOT NULL,
        prompt_text text NOT NULL,
        json_schema_hint text NULL,
        enabled boolean NOT NULL DEFAULT true,
        enforce_mode varchar(16) NOT NULL DEFAULT 'strict',
        version int NOT NULL DEFAULT 1,
        change_note text NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    for (const def of HARD_RULE_DEFAULTS) {
      const exists = await this.repo.findOne({ where: { code: def.code } });
      if (exists) continue;
      await this.repo.save(
        this.repo.create({
          code: def.code,
          name: def.name,
          matchMode: def.matchMode,
          matchPattern: def.matchPattern,
          promptText: def.promptText,
          jsonSchemaHint: def.jsonSchemaHint,
          enabled: true,
          enforceMode: def.enforceMode,
          version: 1,
          changeNote: '系统种子：迁入内置硬规则',
          updatedBy: null,
        }),
      );
      this.logger.log(`已种子硬规则: ${def.code}`);
    }
    await this.refreshCache();
  }
}
