import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

export class SiteStatsQueryDto {
  @IsOptional()
  @IsPostgresUuid()
  siteId?: string;
}

export class DateRangeQueryDto {
  @IsOptional()
  @IsPostgresUuid()
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
  @IsPostgresUuid()
  inspectorId?: string;
}

export class ExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}

export class QueryStatsDto extends PaginationDto {
  @IsOptional()
  @IsPostgresUuid()
  siteId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
