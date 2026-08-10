import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InspectionRecord, SystemBranding } from '../../entities';
import { AiModule } from '../ai/ai.module';
import { UploadModule } from '../upload/upload.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [TypeOrmModule.forFeature([InspectionRecord, SystemBranding]), AiModule, UploadModule],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
