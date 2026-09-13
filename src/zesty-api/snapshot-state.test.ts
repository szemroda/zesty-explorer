import { describe, expect, it } from 'vitest';
import type { CollectionReference } from '../domain';
import { snapshotQueryKey } from './snapshot-state';

const reference = {
  instanceZuid: '8-instance',
  modelZuid: '6-model',
  deployment: 'production',
  area: 'content',
  apiBaseUrl: 'https://8-instance.api.zesty.io/v1',
  managerBaseUrl: 'https://8-instance.manager.zesty.io',
} satisfies CollectionReference;

describe('snapshot state identity', () => {
  it('separates content state and deployment without item identity', () => {
    const itemReference: CollectionReference = {
      ...reference,
      deployment: 'stage',
      itemZuid: '7-ignored',
    };
    expect(snapshotQueryKey(reference, 'latest')).toBe(
      '8-instance:production:6-model:latest:en-US',
    );
    expect(snapshotQueryKey(reference, 'published')).not.toBe(
      snapshotQueryKey(reference, 'latest'),
    );
    expect(snapshotQueryKey(itemReference, 'latest')).toBe('8-instance:stage:6-model:latest:en-US');
  });
});
