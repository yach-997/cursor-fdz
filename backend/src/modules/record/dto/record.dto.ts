import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CheckResult, RecordStatus } from '../../../common/enums';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

export class QueryRecordDto extends PaginationDto {
  @IsOptional()
  @IsPostgresUuid()
  siteId?: string;

  @IsOptional()
  @IsPostgresUuid()
  deviceId?: string;

  @IsOptional()
  @IsPostgresUuid()
  inspectorId?: string;

  @IsOptional()
  @IsString()
  status?: RecordStatus;

  /** 任务名称 / 项目名称关键词 */
  @IsOptional()
  @IsString()
  keyword?: string;

  /** 区域关键词：省/市/现场名 */
  @IsOptional()
  @IsString()
  region?: string;

  /** 设备序列号（模糊） */
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /**
   * history：已提交链路（含通过/驳回/归档，不含未提交进度）
   * audit：待审（已提交且 AI 有不合格）
   */
  @IsOptional()
  @IsString()
  scope?: 'history' | 'audit';
}

export class SubmitRecordDto {
  /** 本次开启的可选分项 templateEntryId（如中压变压器） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledOptionalModuleIds?: string[];

  @IsOptional()
  @IsString()
  gps?: string;

  @IsOptional()
  @IsString()
  accuracy?: string;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}

export class CreateRecordDto {
  @IsPostgresUuid()
  taskId: string;
}

export class DraftEntryDto {
  @IsString()
  templateEntryId: string;

  @IsArray()
  photos: string[];

  @IsOptional()
  @IsString()
  manualResult?: CheckResult;

  @IsOptional()
  finalResult?: CheckResult | null;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class SaveDraftDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftEntryDto)
  entries: DraftEntryDto[];
}

export class RejectRecordDto {
  @IsString()
  reason: string;

  /** 需返工的检查项 templateEntryId；不传则整体驳回 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entryIds?: string[];
}
