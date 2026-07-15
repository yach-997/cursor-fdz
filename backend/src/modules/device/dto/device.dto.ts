import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { DeviceType, DeviceStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

/** 创建设备 DTO */
export class CreateDeviceDto {
  @IsPostgresUuid({ message: '站点ID格式不正确' })
  siteId: string;

  @IsString()
  @IsNotEmpty({ message: '设备序列号不能为空' })
  serialNumber: string;

  @IsEnum(DeviceType, { message: '设备类型不正确' })
  deviceType: DeviceType;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsOptional()
  @IsDateString({}, { message: '安装日期格式不正确' })
  installDate?: string;
}

/** 更新设备 DTO */
export class UpdateDeviceDto {
  @IsOptional()
  @IsPostgresUuid()
  siteId?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsOptional()
  @IsDateString()
  installDate?: string | null;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;
}

/** 设备查询 DTO */
export class QueryDeviceDto extends PaginationDto {
  @IsOptional()
  @IsPostgresUuid()
  siteId?: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;
}
