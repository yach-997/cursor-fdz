import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class AnalyzeDto {
  @IsUUID()
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
