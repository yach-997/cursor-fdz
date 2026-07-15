import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { POSTGRES_UUID_PATTERN } from '../decorators/postgres-uuid.decorator';

@Injectable()
export class ParsePostgresUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!POSTGRES_UUID_PATTERN.test(value)) {
      throw new BadRequestException('Validation failed (UUID is expected)');
    }
    return value;
  }
}
