import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/** 刷新令牌 DTO（兼容 refreshToken / refresh_token） */
export class RefreshTokenDto {
  @Transform(({ obj }) => obj.refreshToken ?? obj.refresh_token)
  @IsString()
  @IsNotEmpty({ message: 'refresh_token 不能为空' })
  refreshToken: string;
}
