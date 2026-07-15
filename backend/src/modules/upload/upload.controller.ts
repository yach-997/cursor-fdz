import {
  Controller,
  Post,
  Get,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Body,
  BadRequestException,
  Query,
  Res,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { UploadService } from './upload.service';
import { LocationCheckDto, UploadPhotoMetaDto } from './dto/upload.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { Public } from '../../common/decorators/public.decorator';

const imageFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!file.mimetype?.startsWith('image/')) {
    cb(new BadRequestException('仅支持图片文件') as any, false);
    return;
  }
  cb(null, true);
};

/** 文件上传：现场原图优先写入七牛，失败回退 MinIO */
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Get('image')
  @Public()
  async image(@Query('url') url: string, @Res() response: Response) {
    if (!url) throw new BadRequestException('缺少图片地址');
    const image = await this.uploadService.fetchPublicImage(url);
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(image.bytes);
  }

  /** 前端直传七牛用（本项目默认仍走服务端 /photo） */
  @Get('qiniu-token')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  qiniuToken() {
    return this.uploadService.getQiniuToken();
  }

  /** 进入巡检、拍照前主动校验是否位于站点范围内。 */
  @Post('location-check')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  checkLocation(
    @Body() dto: LocationCheckDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.uploadService.checkLocation(dto, user);
  }

  @Post('photo')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: imageFilter,
    }),
  )
  async uploadPhoto(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: UploadPhotoMetaDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.uploadService.uploadPhoto(file, meta, user);
  }

  @Post('batch')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  @UseInterceptors(
    FilesInterceptor('files', 9, {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: imageFilter,
    }),
  )
  async uploadBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() meta: UploadPhotoMetaDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.uploadService.uploadBatch(files, meta, user);
  }
}
