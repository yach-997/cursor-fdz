import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Site,
  Device,
  InspectionTask,
  InspectionRecord,
  User,
} from '../../entities';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Site,
      Device,
      InspectionTask,
      InspectionRecord,
      User,
    ]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
