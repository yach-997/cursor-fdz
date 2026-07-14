import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  InspectionTask,
  InspectionRecord,
  Device,
  Site,
  SiteMember,
  User,
} from '../../entities';
import { TemplateModule } from '../template/template.module';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InspectionTask,
      InspectionRecord,
      Device,
      Site,
      SiteMember,
      User,
    ]),
    TemplateModule,
  ],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
