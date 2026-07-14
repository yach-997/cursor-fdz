import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { DeviceType, DeviceStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** 创建设备 DTO */
export class CreateDeviceDto {
  @IsUUID('4', { message: '站点ID格式不正确' })
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
  @IsUUID()
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
  @IsUUID()
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
