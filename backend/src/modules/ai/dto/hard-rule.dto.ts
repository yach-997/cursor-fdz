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

  @IsOptional()
  @IsString()
  jsonSchemaHint?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['strict', 'normal', 'off'])
  enforceMode?: 'strict' | 'normal' | 'off';

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  changeNote: string;
}
