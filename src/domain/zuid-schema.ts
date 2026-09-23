import { Schema } from 'effect';
import type { UserZuid } from './types';

export const UserZuidSchema = Schema.String.pipe(
  Schema.filter((value): value is UserZuid => value.startsWith('5-') || value.startsWith('55-'), {
    message: () => 'Expected a user ZUID beginning with 5- or 55-.',
  }),
);
