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
import { SiteService } from './site.service';
import {
  CreateSiteDto,
  UpdateSiteDto,
  QuerySiteDto,
  AppointManagerDto,
  AppointDeputyDto,
  AddMemberDto,
} from './dto/site.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { ParsePostgresUuidPipe } from '../../common/pipes/parse-postgres-uuid.pipe';

/** 站点管理控制器 */
@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  /** 站点列表（超管全量，站长/巡检员按数据范围） */
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findAll(@Query() query: QuerySiteDto, @CurrentUser() user: CurrentUserContext) {
    return this.siteService.findAll(query, user);
  }

  /** 创建站点（仅管理员） */
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  async create(@Body() dto: CreateSiteDto) {
    return this.siteService.create(dto);
  }

  /** 站点详情 */
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findOne(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.siteService.findOne(id, user);
  }

  /** 更新站点 */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async update(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: UpdateSiteDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.siteService.update(id, dto, user);
  }

  /** 软删除站点（仅管理员，有设备则 400） */
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParsePostgresUuidPipe) id: string) {
    return this.siteService.remove(id);
  }

  /** 任命正站长（仅管理员） */
  @Post(':id/appoint-manager')
  @Roles(UserRole.SUPER_ADMIN)
  async appointManager(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: AppointManagerDto,
  ) {
    return this.siteService.appointManager(id, dto);
  }

  /** 任命副站长（超管或正站长） */
  @Post(':id/deputies')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async appointDeputy(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: AppointDeputyDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.siteService.appointDeputy(id, dto, user);
  }

  /** 移除副站长 */
  @Delete(':id/deputies/:userId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async removeDeputy(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Param('userId', ParsePostgresUuidPipe) userId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.siteService.removeDeputy(id, userId, user);
  }

  /** 站点成员列表（含副站长/巡检员，可按 role 过滤） */
  @Get(':id/members')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async getMembers(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Query('role') role: string | undefined,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.siteService.getMembers(id, user, role);
  }

  /** 聘用巡检员（超管/正站长/副站长；巡检员可同时属于多个站点） */
  @Post(':id/members')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async addMember(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.siteService.addMember(id, dto, user);
  }

  /** 解聘巡检员 */
  @Delete(':id/members/:userId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param('id', ParsePostgresUuidPipe) id: string,
    @Param('userId', ParsePostgresUuidPipe) userId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.siteService.removeMember(id, userId, user);
  }
}
