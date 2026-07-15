import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { AlertStatus } from '../../../entities/alert.entity';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

export class QueryAlertDto extends PaginationDto {
  @IsOptional()
  @IsPostgresUuid()
  siteId?: string;

  @IsOptional()
  @IsString()
  status?: AlertStatus;
}

export class UpsertAlertConfigDto {
  @IsPostgresUuid()
  siteId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  failRateThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(90)
  overdueDays?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyEmails?: string[];

  @IsOptional()
  @IsString()
  webhookUrl?: string;
}

export class QueryAlertConfigDto {
  @IsOptional()
  @IsPostgresUuid()
  siteId?: string;
}
