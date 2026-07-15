import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InspectionRecord, InspectionTask, Device } from '../../entities';
import { RecordService } from './record.service';
import { RecordController } from './record.controller';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InspectionRecord, InspectionTask, Device]),
    UploadModule,
  ],
  controllers: [RecordController],
  providers: [RecordService],
  exports: [RecordService],
})
export class RecordModule {}
