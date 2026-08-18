import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import {
  AiHardRule,
  AiHardRuleCode,
  AiHardRuleEnforceMode,
} from '../../entities/ai-hard-rule.entity';
import { CurrentUserContext } from '../../common/interfaces';
import { HARD_RULE_DEFAULTS, getHardRuleDefault } from './hard-rule.defaults';
import { CreateHardRuleDto, UpdateHardRuleDto } from './dto/hard-rule.dto';

/** 系统内置专项规则（不可删除，可恢复默认） */
export const BUILTIN_HARD_RULE_CODES = new Set<string>([
  'ac_side',
  'grounding',
  'dc_side',
  'fault_record',
  'sungrow',
  'mount_fix',
]);

export type MatchedHardRule = {
  code: string;
  name: string;
  promptText: string;
  jsonSchemaHint: string | null;
  enforceMode: AiHardRuleEnforceMode | string;
  builtin: boolean;
};

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

  isBuiltin(code: string) {
    return BUILTIN_HARD_RULE_CODES.has(code);
  }

  async list() {
    await this.ready;
    await this.refreshCache();
    return [...this.cache.values()]
      .sort((a, b) => {
        const aBuilt = this.isBuiltin(a.code) ? 0 : 1;
        const bBuilt = this.isBuiltin(b.code) ? 0 : 1;
        if (aBuilt !== bBuilt) return aBuilt - bBuilt;
        return a.code.localeCompare(b.code);
      })
      .map((row) => ({
        ...row,
        builtin: this.isBuiltin(row.code),
      }));
  }

  async findByCode(code: string) {
    await this.ready;
    const hit = this.cache.get(code) || (await this.repo.findOne({ where: { code } }));
    if (!hit) throw new NotFoundException('硬规则不存在');
    return { ...hit, builtin: this.isBuiltin(hit.code) };
  }

  /**
   * 按检查项名称+说明匹配启用中的硬规则（enforceMode≠off）。
   */
  async resolveMatchedRules(criteria: string): Promise<MatchedHardRule[]> {
    try {
      await this.ready;
      if (!this.cache.size) await this.refreshCache();
      const text = String(criteria || '');
      const title = text.split(/\r?\n/, 1)[0].trim();
      const out: MatchedHardRule[] = [];
      for (const rule of this.cache.values()) {
        if (!rule.enabled) continue;
        if (String(rule.enforceMode || '') === 'off') continue;
        if (!this.ruleMatches(rule, title, text)) continue;
        const prompt = String(rule.promptText || '').trim();
        if (!prompt) continue;
        out.push({
          code: rule.code,
          name: rule.name,
          promptText: prompt,
          jsonSchemaHint: rule.jsonSchemaHint,
          enforceMode: rule.enforceMode,
          builtin: this.isBuiltin(rule.code),
        });
      }
      return out;
    } catch {
      return [];
    }
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

  composePromptFromCriteria(name: string, passCriteria?: string, failCriteria?: string) {
    const pass = String(passCriteria || '').trim();
    const fail = String(failCriteria || '').trim();
    const lines = [`【${name.trim() || '检查项'}·硬性判定】`];
    if (pass) {
      lines.push('合格标准：');
      lines.push(pass);
    }
    if (fail) {
      lines.push('不合格（必须 fail）：');
      lines.push(fail);
    }
    lines.push('拿不准、画面不全、关键点不可见必须判 fail，禁止放水合格。');
    return lines.join('\n');
  }

  async create(dto: CreateHardRuleDto, user: CurrentUserContext) {
    await this.ready;
    const name = dto.name.trim();
    const matchPattern = dto.matchPattern.trim();
    if (!matchPattern) throw new BadRequestException('请填写匹配关键词');

    let promptText = String(dto.promptText || '').trim();
    if (!promptText) {
      const pass = String(dto.passCriteria || '').trim();
      const fail = String(dto.failCriteria || '').trim();
      if (!pass && !fail) {
        throw new BadRequestException('请填写合格标准或不合格标准（或完整硬规则正文）');
      }
      promptText = this.composePromptFromCriteria(name, pass, fail);
    }
    if (promptText.length < 10) {
      throw new BadRequestException('硬规则正文过短，请补充判定标准');
    }

    const code = `custom_${randomBytes(4).toString('hex')}`;
    const saved = await this.repo.save(
      this.repo.create({
        code,
        name,
        matchMode: dto.matchMode || 'criteria_includes',
        matchPattern,
        promptText,
        jsonSchemaHint: dto.jsonSchemaHint ? String(dto.jsonSchemaHint).trim() : null,
        enabled: dto.enabled !== false,
        enforceMode: dto.enforceMode || 'strict',
        version: 1,
        changeNote: (dto.changeNote || '新建自定义硬规则').trim(),
        updatedBy: user.id,
      }),
    );
    this.cache.set(saved.code, saved);
    this.logger.log(`硬规则已创建: ${saved.code} by ${user.username || user.id}`);
    return { ...saved, builtin: false };
  }

  async update(code: string, dto: UpdateHardRuleDto, user: CurrentUserContext) {
    await this.ready;
    const rule = await this.repo.findOne({ where: { code } });
    if (!rule) throw new NotFoundException('硬规则不存在');

    if (dto.name !== undefined) rule.name = dto.name.trim();
    if (dto.matchMode !== undefined) rule.matchMode = dto.matchMode;
    if (dto.matchPattern !== undefined) rule.matchPattern = dto.matchPattern.trim();

    const pass = dto.passCriteria !== undefined ? String(dto.passCriteria || '').trim() : '';
    const fail = dto.failCriteria !== undefined ? String(dto.failCriteria || '').trim() : '';
    if (dto.promptText !== undefined) {
      rule.promptText = dto.promptText.trim();
    } else if (pass || fail) {
      rule.promptText = this.composePromptFromCriteria(rule.name, pass || undefined, fail || undefined);
    }

    if (dto.jsonSchemaHint !== undefined) {
      rule.jsonSchemaHint = dto.jsonSchemaHint ? String(dto.jsonSchemaHint).trim() : null;
    }
    if (dto.enabled !== undefined) rule.enabled = dto.enabled;
    if (dto.enforceMode !== undefined) rule.enforceMode = dto.enforceMode;
    rule.changeNote = (dto.changeNote || '更新硬规则').trim();
    rule.updatedBy = user.id;
    rule.version = Number(rule.version || 1) + 1;

    const saved = await this.repo.save(rule);
    this.cache.set(saved.code, saved);
    this.logger.log(`硬规则已更新: ${saved.code} v${saved.version} by ${user.username || user.id}`);
    return { ...saved, builtin: this.isBuiltin(saved.code) };
  }

  async remove(code: string, user: CurrentUserContext) {
    await this.ready;
    if (this.isBuiltin(code)) {
      throw new BadRequestException('系统内置规则不能删除，可停用或恢复默认');
    }
    const rule = await this.repo.findOne({ where: { code } });
    if (!rule) throw new NotFoundException('硬规则不存在');
    await this.repo.remove(rule);
    this.cache.delete(code);
    this.logger.log(`硬规则已删除: ${code} by ${user.username || user.id}`);
    return { ok: true, code };
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

  private ruleMatches(rule: AiHardRule, title: string, fullText: string) {
    const patterns = String(rule.matchPattern || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!patterns.length) return false;
    const mode = String(rule.matchMode || 'criteria_includes');
    if (mode === 'title_exact') {
      return patterns.some((p) => title === p);
    }
    if (mode === 'title_includes') {
      return patterns.some((p) => title.includes(p));
    }
    return patterns.some((p) => fullText.includes(p));
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
