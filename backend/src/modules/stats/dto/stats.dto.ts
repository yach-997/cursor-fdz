import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class SiteStatsQueryDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class DateRangeQueryDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  /** 区域关键词 */
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  deviceType?: string;

  @IsOptional()
  @IsUUID()
  inspectorId?: string;
}

export class ExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}

export class QueryStatsDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
