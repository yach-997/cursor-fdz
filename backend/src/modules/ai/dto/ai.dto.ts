import { IsArray, IsOptional, IsString } from 'class-validator';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

export class AnalyzeDto {
  @IsPostgresUuid()
  recordId: string;

  @IsString()
  templateEntryId: string;

  @IsString()
  photoUrl: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  samplePhotoUrls?: string[];
}
