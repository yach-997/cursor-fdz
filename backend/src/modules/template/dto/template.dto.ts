import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsIn,
  ValidateNested,
  IsInt,
  Min,
  MaxLength,
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

/** 产品线变体 DTO */
export class TemplateProductLineDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  entries: TemplateEntryDto[];
}

/** 创建模板 */
export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  entries?: TemplateEntryDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateProductLineDto)
  productLines?: TemplateProductLineDto[];

  @IsBoolean()
  isGlobal: boolean;

  /** 兼容旧设备巡检；自定义任务类型可不传，后端默认 string_inverter */
  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsPostgresUuid({ message: '网格标识格式不正确' })
  siteId?: string | null;

  @IsOptional()
  @IsIn(['single', 'multi'])
  assignMode?: 'single' | 'multi';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unitLabel?: string;

  @IsOptional()
  @IsBoolean()
  expenseEnabledDefault?: boolean;
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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateProductLineDto)
  productLines?: TemplateProductLineDto[];

  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @IsOptional()
  @IsPostgresUuid({ message: '网格标识格式不正确' })
  siteId?: string | null;

  @IsOptional()
  @IsIn(['single', 'multi'])
  assignMode?: 'single' | 'multi';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unitLabel?: string;

  @IsOptional()
  @IsBoolean()
  expenseEnabledDefault?: boolean;
}

/** 查询模板 */
export class QueryTemplateDto {
  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsPostgresUuid({ message: '网格标识格式不正确' })
  siteId?: string;

  /** 按模板名称模糊搜索 */
  @IsOptional()
  @IsString()
  keyword?: string;
}

/** 克隆模板到网格 */
export class CloneTemplateDto {
  @IsPostgresUuid({ message: '网格标识格式不正确' })
  siteId: string;
}
