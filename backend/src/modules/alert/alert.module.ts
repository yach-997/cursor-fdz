import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AlertConfig,
  AlertRecord,
  Site,
  InspectionTask,
  InspectionRecord,
} from '../../entities';
import { AlertService } from './alert.service';
import { AlertController } from './alert.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AlertConfig,
      AlertRecord,
      Site,
      InspectionTask,
      InspectionRecord,
    ]),
  ],
  controllers: [AlertController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
