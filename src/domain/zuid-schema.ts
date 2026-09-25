import { Schema } from 'effect';
import type { CodeFileZuid, ModelZuid, UserZuid } from './types';

export const UserZuidSchema = Schema.String.pipe(
  Schema.filter((value): value is UserZuid => value.startsWith('5-') || value.startsWith('55-'), {
    message: () => 'Expected a user ZUID beginning with 5- or 55-.',
  }),
);

/** A content model (collection) ZUID. */
export function isModelZuid(value: string): value is ModelZuid {
  return /^6-[a-z0-9][a-z0-9-]{4,}$/i.test(value);
}

/** A `/web/views` file ZUID, as returned by Zesty and named in Code links. */
export function isCodeFileZuid(value: string): value is CodeFileZuid {
  return /^11-[a-z0-9][a-z0-9-]{4,}$/i.test(value);
}
