import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InspectionRecord } from '../../entities';
import { AiModule } from '../ai/ai.module';
import { UploadModule } from '../upload/upload.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [TypeOrmModule.forFeature([InspectionRecord]), AiModule, UploadModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
