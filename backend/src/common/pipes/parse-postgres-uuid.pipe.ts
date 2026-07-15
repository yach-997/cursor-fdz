import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { POSTGRES_UUID_PATTERN } from '../decorators/postgres-uuid.decorator';

@Injectable()
export class ParsePostgresUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!POSTGRES_UUID_PATTERN.test(value)) {
      throw new BadRequestException('参数格式错误，请检查后重试');
    }
    return value;
  }
}
