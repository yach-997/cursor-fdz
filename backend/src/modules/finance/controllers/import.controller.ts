import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums';
import { CurrentUserContext } from '../../../common/interfaces';
import { FinanceImportService } from '../services/finance-import.service';
import { ImportPreviewQueryDto } from '../dto/finance.dto';

const excelOptions = { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } };

@Controller('import')
export class FinanceImportController {
  constructor(private readonly service: FinanceImportService) {}
  @Post('gsp-cases')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @UseInterceptors(FileInterceptor('file', excelOptions))
  gsp(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: ImportPreviewQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.importGsp(file, user, query.preview === 'true');
  }
  @Post('po-orders')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  @UseInterceptors(FileInterceptor('file', excelOptions))
  po(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: ImportPreviewQueryDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.service.importPo(file, user, query.preview === 'true');
  }
  @Get('batches') @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER) batches(
    @Query('type') type?: string,
  ) {
    return this.service.listBatches(type);
  }
  @Get('batches/:id/failures')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER)
  async failures(@Param('id') id: string, @Res() res: Response) {
    const failures = await this.service.failures(id);
    const csv = [
      '行号,失败原因',
      ...failures.map((x) => `${x.row},"${x.reason.replace(/"/g, '""')}"`),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-${id}-failures.csv"`);
    res.send('\ufeff' + csv);
  }
}
