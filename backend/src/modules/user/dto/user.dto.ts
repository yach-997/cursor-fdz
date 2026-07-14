import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MinLength,
  Matches,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { UserRole, CommonStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** 创建用户 DTO（支持多角色） */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @IsString()
  @MinLength(6, { message: '密码至少6位' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: '真实姓名不能为空' })
  realName: string;

  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  /** 多角色；兼容旧字段 role */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: '至少选择一个角色' })
  @IsEnum(UserRole, { each: true, message: '角色不正确' })
  roles?: UserRole[];

  @IsOptional()
  @IsEnum(UserRole, { message: '角色不正确' })
  role?: UserRole;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  region?: string;
}

/** 更新用户 DTO */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  realName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

/** 用户查询 DTO */
export class QueryUserDto extends PaginationDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(CommonStatus, { message: '状态不正确' })
  status: CommonStatus;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6, { message: '新密码至少6位' })
  newPassword: string;
}

export class QueryPoolDto extends PaginationDto {
  @IsOptional()
  @IsString()
  keyword?: string;
}
