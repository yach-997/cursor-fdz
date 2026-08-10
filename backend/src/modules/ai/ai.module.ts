import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InspectionRecord, InspectionTask, AiHardRule } from '../../entities';
import { RecordModule } from '../record/record.module';
import { UploadModule } from '../upload/upload.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { VisionService } from './vision.service';
import { HardRuleService } from './hard-rule.service';
import { HardRuleController } from './hard-rule.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([InspectionRecord, InspectionTask, AiHardRule]),
    RecordModule,
    UploadModule,
  ],
  controllers: [AiController, HardRuleController],
  providers: [AiService, VisionService, HardRuleService],
  exports: [AiService, VisionService, HardRuleService],
})
export class AiModule {}
