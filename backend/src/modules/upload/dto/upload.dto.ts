import { IsOptional, IsString, IsUUID } from 'class-validator';

/** 拍照上传附加元数据（水印用） */
export class UploadPhotoMetaDto {
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsString()
  gps?: string;

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
