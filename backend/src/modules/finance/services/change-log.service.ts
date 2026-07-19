import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChangeLog } from '../../../entities';

@Injectable()
export class ChangeLogService {
  constructor(@InjectRepository(ChangeLog) private readonly repo: Repository<ChangeLog>) {}
  async write(
    entityType: string,
    entityId: string,
    field: string,
    oldValue: unknown,
    newValue: unknown,
    operatorId: string | null,
    reason: string,
  ) {
    return this.repo.save(
      this.repo.create({
        entityType,
        entityId,
        field,
        oldValue: oldValue === undefined || oldValue === null ? null : JSON.stringify(oldValue),
        newValue: newValue === undefined || newValue === null ? null : JSON.stringify(newValue),
        operatorId,
        reason,
      }),
    );
  }
  list(entityType: string, entityId: string) {
    return this.repo.find({ where: { entityType, entityId }, order: { createdAt: 'DESC' } });
  }
}
