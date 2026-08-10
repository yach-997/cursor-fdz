import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  systemName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  subtitle?: string;

  /** 传空字符串可清除 logo；须为可访问的图片 URL */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  logoUrl?: string | null;
}
