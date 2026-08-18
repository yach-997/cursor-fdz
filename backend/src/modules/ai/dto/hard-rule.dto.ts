import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateHardRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsIn(['title_exact', 'title_includes', 'criteria_includes'])
  matchMode?: 'title_exact' | 'title_includes' | 'criteria_includes';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  matchPattern?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  promptText?: string;

  /** 简易配置：合格标准（与 failCriteria 一起合成 promptText） */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  passCriteria?: string;

  /** 简易配置：不合格标准 */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  failCriteria?: string;

  @IsOptional()
  @IsString()
  jsonSchemaHint?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['strict', 'normal', 'off'])
  enforceMode?: 'strict' | 'normal' | 'off';

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  changeNote?: string;
}

export class CreateHardRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsIn(['title_exact', 'title_includes', 'criteria_includes'])
  matchMode?: 'title_exact' | 'title_includes' | 'criteria_includes';

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  matchPattern!: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20000)
  promptText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  passCriteria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  failCriteria?: string;

  @IsOptional()
  @IsString()
  jsonSchemaHint?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['strict', 'normal', 'off'])
  enforceMode?: 'strict' | 'normal' | 'off';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}
