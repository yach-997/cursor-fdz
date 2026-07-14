import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InspectionRecord, InspectionTask } from '../../entities';
import { RecordModule } from '../record/record.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { VisionService } from './vision.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InspectionRecord, InspectionTask]),
    RecordModule,
  ],
  controllers: [AiController],
  providers: [AiService, VisionService],
  exports: [AiService, VisionService],
})
export class AiModule {}
