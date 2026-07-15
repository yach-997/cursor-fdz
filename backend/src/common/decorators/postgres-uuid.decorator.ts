import { Matches, ValidationOptions } from 'class-validator';

/** PostgreSQL accepts UUID values even when their version/variant bits are non-RFC. */
export const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function IsPostgresUuid(options?: ValidationOptions): PropertyDecorator {
  return Matches(POSTGRES_UUID_PATTERN, options);
}
