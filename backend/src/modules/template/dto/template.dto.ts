import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeviceType, CheckType } from '../../../common/enums';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

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
  @IsPostgresUuid({ message: 'siteId must be a UUID' })
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
  @IsPostgresUuid({ message: 'siteId must be a UUID' })
  siteId?: string | null;
}

/** 查询模板 */
export class QueryTemplateDto {
  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsPostgresUuid({ message: 'siteId must be a UUID' })
  siteId?: string;
}

/** 克隆模板到站点 */
export class CloneTemplateDto {
  @IsPostgresUuid({ message: 'siteId must be a UUID' })
  siteId: string;
}
