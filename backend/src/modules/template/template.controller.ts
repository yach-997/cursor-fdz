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
} from '@nestjs/common';
import { TemplateService } from './template.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  QueryTemplateDto,
  CloneTemplateDto,
} from './dto/template.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

/** 巡检模板控制器 */
@Controller('templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findAll(@Query() query: QueryTemplateDto, @CurrentUser() user: CurrentUserContext) {
    return this.templateService.findAll(query, user);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async create(@Body() dto: CreateTemplateDto, @CurrentUser() user: CurrentUserContext) {
    return this.templateService.create(dto, user);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.templateService.findOne(id, user);
  }

  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.templateService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.templateService.remove(id, user);
  }

  @Post(':id/clone')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async clone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloneTemplateDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.templateService.clone(id, dto, user);
  }
}
