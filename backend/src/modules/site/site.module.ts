import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site, Device, User, SiteMember } from '../../entities';
import { SiteService } from './site.service';
import { SiteScopeService } from './site-scope.service';
import { SiteController } from './site.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Site, Device, User, SiteMember])],
  controllers: [SiteController],
  providers: [SiteService, SiteScopeService],
  exports: [SiteService, SiteScopeService],
})
export class SiteModule {}
