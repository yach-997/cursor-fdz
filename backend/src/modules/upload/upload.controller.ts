import {
  Controller,
  Post,
  Get,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadService } from './upload.service';
import { UploadPhotoMetaDto } from './dto/upload.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';

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

/** 文件上传：水印后优先七牛，失败回退 MinIO */
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /** 前端直传七牛用（本项目默认仍走服务端 /photo） */
  @Get('qiniu-token')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SITE_MANAGER, UserRole.INSPECTOR)
  qiniuToken() {
    return this.uploadService.getQiniuToken();
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
