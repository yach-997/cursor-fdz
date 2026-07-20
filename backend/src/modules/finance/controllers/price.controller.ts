import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import {
  CreatePriceDto,
  ImportPreviewQueryDto,
  PriceQueryDto,
  UpdatePriceDto,
  SaveItemMappingDto,
} from '../dto/finance.dto';
import { FinanceImportService } from '../services/finance-import.service';
import { PriceService } from '../services/price.service';
import { PriceMappingService } from '../services/price-mapping.service';

@Controller('prices')
export class FinancePriceController {
  constructor(
    private readonly service: PriceService,
    private readonly importer: FinanceImportService,
    private readonly mappings: PriceMappingService,
  ) {}
  @Get('mappings') @Roles(UserRole.SUPER_ADMIN) listMappings() {
    return this.mappings.list();
  }
  @Post('mappings') @Roles(UserRole.SUPER_ADMIN) saveMapping(
    @Body() dto: SaveItemMappingDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.mappings.save(dto.sourceItemName, dto.targetItemCode, user);
  }
  @Post('mappings/recalculate') @Roles(UserRole.SUPER_ADMIN) recalculateMappings() {
    return this.mappings.recalculate();
  }
  @Get() @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) list(
    @Query() query: PriceQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.list(query, user);
  }
  @Post() @Roles(UserRole.SUPER_ADMIN) create(
    @Body() dto: CreatePriceDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.create(dto, user);
  }
  @Put(':id') @Roles(UserRole.SUPER_ADMIN) update(
    @Param('id') id: string,
    @Body() dto: UpdatePriceDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.update(id, dto, user);
  }
  @Post('import')
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  import(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: ImportPreviewQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.importer.importSettlePrices(file, user, query.preview === 'true', {
      offset: query.offset,
      limit: query.limit,
      batchId: query.batchId,
    });
  }
  @Get(':id/history') @Roles(UserRole.SUPER_ADMIN) history(@Param('id') id: string) {
    return this.service.history(id);
  }
}
