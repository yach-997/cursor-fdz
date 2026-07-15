import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  CreateUserDto,
  UpdateUserDto,
  QueryUserDto,
  UpdateUserStatusDto,
  ResetPasswordDto,
  QueryPoolDto,
} from './dto/user.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { ParsePostgresUuidPipe } from '../../common/pipes/parse-postgres-uuid.pipe';

/** 用户/人才池控制器 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** 用户列表 */
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async findAll(@Query() query: QueryUserDto, @CurrentUser() user: CurrentUserContext) {
    return this.userService.findAll(query, user);
  }

  /** 人才池（须放在 :id 路由之前） */
  @Get('inspectors/pool')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async getPool(@Query() query: QueryPoolDto, @CurrentUser() user: CurrentUserContext) {
    return this.userService.getInspectorPool(query, user);
  }

  /** 创建用户 */
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: CurrentUserContext) {
    return this.userService.create(dto, user);
  }

  /** 更新用户 */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async update(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.userService.update(id, dto, user);
  }

  /** 启用/停用 */
  @Put(':id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async updateStatus(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.userService.updateStatus(id, dto, user);
  }

  /** 重置密码 */
  @Put(':id/reset-password')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.userService.resetPassword(id, dto, user);
  }
}
