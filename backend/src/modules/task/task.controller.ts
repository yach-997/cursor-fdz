import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TaskService } from './task.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  ReassignTaskDto,
} from './dto/task.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { ParsePostgresUuidPipe } from '../../common/pipes/parse-postgres-uuid.pipe';

/** 巡检任务控制器 */
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findAll(@Query() query: QueryTaskDto, @CurrentUser() user: CurrentUserContext) {
    return this.taskService.findAll(query, user);
  }

  /** 管理员与巡检员均可创建 */
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: CurrentUserContext) {
    return this.taskService.create(dto, user);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findOne(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.findOne(id, user);
  }

  /** 仅管理员可编辑 */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async update(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.update(id, dto, user);
  }

  @Put(':id/start')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @HttpCode(HttpStatus.OK)
  async start(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.start(id, user);
  }

  /** 删除未完成任务（管理员 / 巡检员本人） */
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.remove(id, user);
  }

  /** 删除备用（部分代理对 DELETE 支持不好时用） */
  @Put(':id/remove')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @HttpCode(HttpStatus.OK)
  async removeByPut(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.remove(id, user);
  }

  /** 归档：仅管理员 */
  @Put(':id/archive')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.archive(id, user);
  }

  @Put(':id/cancel')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.archive(id, user);
  }

  @Put(':id/reassign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async reassign(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: ReassignTaskDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.taskService.reassign(id, dto, user);
  }
}
