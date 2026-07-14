import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device, Site, InspectionTask, InspectionRecord } from '../../entities';
import { DeviceService } from './device.service';
import { DeviceController } from './device.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, Site, InspectionTask, InspectionRecord]),
  ],
  controllers: [DeviceController],
  providers: [DeviceService],
  exports: [DeviceService],
})
export class DeviceModule {}
