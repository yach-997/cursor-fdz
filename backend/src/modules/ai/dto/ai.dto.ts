import { IsArray, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

export class AnalyzeDto {
  @IsPostgresUuid()
  recordId: string;

  @IsString()
  templateEntryId: string;

  /** 兼容旧客户端：单张现场照片 */
  @IsOptional()
  @IsString()
  photoUrl?: string;

  /** 多角度现场照片（优先使用） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  samplePhotoUrls?: string[];
}
