import { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { CollectionCatalogEntry, CollectionSchema, CollectionSnapshot } from '../../domain';
import { parseCsv } from '../../import-check';
import { collectionNode, queryClientWrapper } from '../../test/fixtures';
import type { CollectionApi } from '../../zesty-api';
import { useImportCheck } from './useImportCheck';

describe('import check query', () => {
  it('compares the file with items in the instance default language', async () => {
    const loadCollectionSnapshot = vi.fn<CollectionApi['loadCollectionSnapshot']>(
      (reference, scope) =>
        Effect.succeed({
          id: `snapshot-${reference.modelZuid}`,
          instanceZuid: reference.instanceZuid,
          modelZuid: reference.modelZuid,
          ...scope,
          items: [],
          itemsById: new Map(),
          partial: false,
        } satisfies CollectionSnapshot),
    );
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadLanguages: () =>
        Effect.succeed([
          { code: 'en-US', name: 'English (US)', isDefault: false },
          { code: 'de-DE', name: 'German', isDefault: true },
        ]),
      loadCollectionSchema: (reference) =>
        Effect.succeed({
          modelZuid: reference.modelZuid,
          label: 'Stores',
          fields: [
            {
              id: '12-region',
              name: 'region',
              label: 'Region',
              kind: 'relationship',
              relatedModelZuid: '6-region',
            },
          ],
        } satisfies CollectionSchema),
      loadCollectionSnapshot,
    };
    const collection: CollectionCatalogEntry = {
      label: 'Stores',
      name: 'stores',
      type: 'dataset',
      group: 'content',
      reference: collectionNode('node-stores', '6-stores').reference,
    };
    const { result } = renderHook(
      () =>
        useImportCheck({
          api,
          credentials: { revision: 'revision', sessionToken: 'session-token' },
          collection,
          source: { fileName: 'stores.csv', parsed: parseCsv('title\nBerlin\n') },
          mapping: undefined,
        }),
      { wrapper: queryClientWrapper(new QueryClient()) },
    );

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(
      loadCollectionSnapshot.mock.calls.map(([reference, scope]) => [reference.modelZuid, scope]),
    ).toEqual([
      ['6-stores', { state: 'latest', language: 'de-DE' }],
      ['6-region', { state: 'latest', language: 'de-DE' }],
    ]);
  });
});
