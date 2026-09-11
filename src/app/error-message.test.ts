import { describe, expect, it } from 'vitest';
import type { ExplorerError } from '../domain';
import { describeExplorerError } from './error-message';

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
  { kind: 'cancelled', message: 'cancelled' },
];

describe('explorer error messages', () => {
  it.each(failures)('gives $kind failures an actionable recovery', (failure) => {
    const result = describeExplorerError(failure);
    expect(result.message).toBe(failure.message);
    expect(result.recovery.length).toBeGreaterThan(10);
  });
});
