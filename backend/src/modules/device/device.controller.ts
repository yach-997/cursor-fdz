import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DeviceService } from './device.service';
import { CreateDeviceDto, UpdateDeviceDto, QueryDeviceDto } from './dto/device.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

/** 设备管理控制器 */
@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  /** 设备列表 */
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findAll(@Query() query: QueryDeviceDto, @CurrentUser() user: CurrentUserContext) {
    return this.deviceService.findAll(query, user);
  }

  /** 批量导入 Excel（须放在 :id 之前） */
  @Post('batch-import')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @UseInterceptors(FileInterceptor('file'))
  async batchImport(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.deviceService.batchImport(file, user);
  }

  /** 创建设备 */
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async create(@Body() dto: CreateDeviceDto, @CurrentUser() user: CurrentUserContext) {
    return this.deviceService.create(dto, user);
  }

  /** 设备详情 */
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.deviceService.findOne(id, user);
  }

  /** 设备巡检历史 */
  @Get(':id/history')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async getHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.deviceService.getHistory(id, user);
  }

  /** 更新设备 */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.deviceService.update(id, dto, user);
  }

  /** 删除设备 */
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.deviceService.remove(id, user);
  }
}
