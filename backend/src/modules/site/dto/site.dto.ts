import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsEnum,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommonStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

/** 创建站点 DTO */
export class CreateSiteDto {
  @IsString()
  @IsNotEmpty({ message: '站点名称不能为空' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: '站点编码不能为空' })
  code: string;

  @IsString()
  @IsNotEmpty()
  province: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  district: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @Type(() => Number)
  @IsNumber()
  @IsLatitude({ message: '纬度格式不正确' })
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  @IsLongitude({ message: '经度格式不正确' })
  longitude: number;

  @IsOptional()
  @IsPostgresUuid({ message: '站长ID格式不正确' })
  managerId?: string;
}

/** 更新站点 DTO */
export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsPostgresUuid()
  managerId?: string | null;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 站点查询 DTO */
export class QuerySiteDto extends PaginationDto {
  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsPostgresUuid()
  managerId?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}

/** 任命正站长 DTO */
export class AppointManagerDto {
  @IsPostgresUuid({ message: '用户ID格式不正确' })
  @IsNotEmpty()
  userId: string;
}

/** 任命副站长 DTO */
export class AppointDeputyDto {
  @IsPostgresUuid({ message: '用户ID格式不正确' })
  @IsNotEmpty()
  userId: string;
}

/** 聘用巡检员 DTO（同一巡检员可加入多个站点） */
export class AddMemberDto {
  @IsPostgresUuid({ message: '用户ID格式不正确' })
  @IsNotEmpty()
  userId: string;
}
