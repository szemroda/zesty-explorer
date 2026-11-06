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
  it('separates content state, language and deployment without item identity', () => {
    const itemReference: CollectionReference = {
      ...reference,
      deployment: 'stage',
      itemZuid: '7-ignored',
    };
    expect(snapshotQueryKey(reference, { state: 'latest', language: 'en-US' })).toBe(
      '8-instance:production:6-model:latest:en-US',
    );
    expect(snapshotQueryKey(reference, { state: 'published', language: 'en-US' })).not.toBe(
      snapshotQueryKey(reference, { state: 'latest', language: 'en-US' }),
    );
    expect(snapshotQueryKey(itemReference, { state: 'latest', language: 'de-DE' })).toBe(
      '8-instance:stage:6-model:latest:de-DE',
    );
  });
});
