import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { AlertStatus } from '../../../entities/alert.entity';

export class QueryAlertDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsString()
  status?: AlertStatus;
}

export class UpsertAlertConfigDto {
  @IsUUID()
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
  @IsUUID()
  siteId?: string;
}
