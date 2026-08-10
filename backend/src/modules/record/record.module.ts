import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  InspectionRecord,
  InspectionTask,
  Device,
  ServiceCase,
  CaseWorkUnit,
  User,
} from '../../entities';
import { RecordService } from './record.service';
import { RecordController } from './record.controller';
import { UploadModule } from '../upload/upload.module';
import { AlertModule } from '../alert/alert.module';
import { GeocodeModule } from '../geocode/geocode.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InspectionRecord,
      InspectionTask,
      Device,
      ServiceCase,
      CaseWorkUnit,
      User,
    ]),
    UploadModule,
    AlertModule,
    GeocodeModule,
  ],
  controllers: [RecordController],
  providers: [RecordService],
  exports: [RecordService],
})
export class RecordModule {}
