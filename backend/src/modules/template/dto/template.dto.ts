import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  Matches,
  IsArray,
  ValidateNested,
  IsNumber,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeviceType, CheckType } from '../../../common/enums';

// PostgreSQL 接受任意十六进制 UUID；历史种子数据并不都满足 RFC v4 的 variant 位。
const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 模板条目 DTO */
export class TemplateEntryDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  description: string;

  @IsBoolean()
  isRequired: boolean;

  @IsInt()
  @Min(0)
  order: number;

  @IsArray()
  @IsString({ each: true })
  samplePhotos: string[];

  @IsEnum(CheckType)
  checkType: CheckType;

  @IsOptional()
  @IsBoolean()
  isOptionalModule?: boolean;
}

/** 创建模板 */
export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(DeviceType)
  deviceType: DeviceType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  entries: TemplateEntryDto[];

  @IsBoolean()
  isGlobal: boolean;

  @IsOptional()
  @Matches(POSTGRES_UUID_PATTERN, { message: 'siteId must be a UUID' })
  siteId?: string | null;
}

/** 更新模板（修改后 version+1） */
export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  entries?: TemplateEntryDto[];

  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @IsOptional()
  @Matches(POSTGRES_UUID_PATTERN, { message: 'siteId must be a UUID' })
  siteId?: string | null;
}

/** 查询模板 */
export class QueryTemplateDto {
  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @Matches(POSTGRES_UUID_PATTERN, { message: 'siteId must be a UUID' })
  siteId?: string;
}

/** 克隆模板到站点 */
export class CloneTemplateDto {
  @Matches(POSTGRES_UUID_PATTERN, { message: 'siteId must be a UUID' })
  siteId: string;
}
