import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

/** 拍照上传附加元数据（现场定位校验用） */
export class UploadPhotoMetaDto {
  @IsOptional()
  @IsPostgresUuid()
  taskId?: string;

  @IsOptional()
  @IsString()
  gps?: string;

  @IsOptional()
  @IsString()
  accuracy?: string;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @IsOptional()
  @IsDateString()
  photoTakenAt?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  siteName?: string;

  @IsOptional()
  @IsString()
  inspectorName?: string;
}

export class LocationCheckDto {
  @IsPostgresUuid()
  taskId: string;

  @IsString()
  gps: string;

  @IsString()
  accuracy: string;

  @IsDateString()
  capturedAt: string;
}
