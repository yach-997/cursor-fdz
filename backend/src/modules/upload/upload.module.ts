import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InspectionTask, Site, Device, User } from '../../entities';
import { MinioService } from './minio.service';
import { QiniuService } from './qiniu.service';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { GeocodeModule } from '../geocode/geocode.module';
import { LocationGuardService } from './location-guard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InspectionTask, Site, Device, User]),
    GeocodeModule,
  ],
  controllers: [UploadController],
  providers: [MinioService, QiniuService, LocationGuardService, UploadService],
  exports: [MinioService, QiniuService, LocationGuardService, UploadService],
})
export class UploadModule {}
