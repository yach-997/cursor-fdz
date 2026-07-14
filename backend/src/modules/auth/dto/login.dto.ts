import { IsNotEmpty, IsString, MinLength, IsIn, IsOptional } from 'class-validator';

/** 登录请求 DTO：用户名 + 密码 + 登录端 */
export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少6位' })
  password: string;

  /** pc=管理端（站长/副站长/超管）；h5=巡检端 */
  @IsOptional()
  @IsIn(['pc', 'h5'], { message: 'client 只能是 pc 或 h5' })
  client?: 'pc' | 'h5';
}
