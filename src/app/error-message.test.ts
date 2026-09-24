import { describe, expect, it } from 'vitest';
import type { ExplorerError } from '../domain';
import { describeExplorerError } from './error-message';

const origin = 'http://localhost:5173';
const genericRecovery = describeExplorerError(
  { kind: 'cancelled', message: 'cancelled' },
  origin,
).recovery;

const failures: readonly ExplorerError[] = [
  { kind: 'invalid-input', message: 'invalid' },
  { kind: 'blocked-host', message: 'blocked' },
  { kind: 'authentication', status: 401, message: 'authentication' },
  { kind: 'permission', status: 403, message: 'permission' },
  { kind: 'missing-resource', status: 404, message: 'missing' },
  { kind: 'decoding', message: 'decoding' },
  { kind: 'network', message: 'network' },
  { kind: 'timeout', message: 'timeout' },
  { kind: 'rate-limit', message: 'rate limit' },
  { kind: 'server', status: 503, message: 'server' },
  { kind: 'data-limit', scope: 'view', message: 'limit' },
];

describe('explorer error messages', () => {
  it.each(failures)('keeps the $kind message and gives it a specific recovery', (failure) => {
    const { message, recovery } = describeExplorerError(failure, origin);
    expect(message).toBe(failure.message);
    expect(recovery).toMatch(/\w/);
    expect(recovery).not.toBe(genericRecovery);
  });

  it('points network failures at requests from the browser origin', () => {
    expect(
      describeExplorerError({ kind: 'network', message: 'Offline' }, origin).recovery,
    ).toContain(origin);
  });
});
