import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { DeviceType, TaskStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** 创建任务（设备用 deviceId 或 serialNumber 二选一） */
export class CreateTaskDto {
  @IsUUID()
  siteId: string;

  @ValidateIf((o) => !o.serialNumber)
  @IsUUID()
  deviceId?: string;

  /** 关联设备序列号（与 deviceId 二选一） */
  @ValidateIf((o) => !o.deviceId)
  @IsString()
  @IsNotEmpty()
  serialNumber?: string;

  @IsString()
  @IsNotEmpty()
  taskName: string;

  /**
   * 巡检员：管理员可指定；巡检员自建时可省略（默认本人）
   */
  @IsOptional()
  @IsUUID()
  inspectorId?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}

/** 更新任务（管理员，仅未开始可改） */
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  taskName?: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsUUID()
  inspectorId?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}

/** 查询任务 */
export class QueryTaskDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  /** 区域关键词：匹配站点省/市/区/名称 */
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  /**
   * 简化状态筛选：not_started / in_progress / completed
   * 与 status 二选一，优先 status
   */
  @IsOptional()
  @IsString()
  statusGroup?: string;

  @IsOptional()
  @IsUUID()
  inspectorId?: string;

  /** 创建时间起（含） */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** 创建时间止（含） */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** 任务名称关键词 */
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;
}

/** 改派巡检员 */
export class ReassignTaskDto {
  @IsUUID()
  inspectorId: string;
}
