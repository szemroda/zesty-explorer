import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { ContentItem, ContentItemReference } from '../../domain';
import { queryClientWrapper } from '../../test/fixtures';
import type { ItemVersionApi } from '../../zesty-api';
import { useItemVersionPreview } from './useItemVersionPreview';

const reference: ContentItemReference = {
  instanceZuid: '8-instance',
  modelZuid: '6-model',
  itemZuid: '7-item-one',
  deployment: 'production',
  area: 'content',
  apiBaseUrl: 'https://8-instance.api.zesty.io/v1',
  managerBaseUrl: 'https://8-instance.manager.zesty.io',
};

const currentItem: ContentItem = {
  id: '7-item-one',
  fields: { title: 'Current' },
  metadata: { version: 1 },
  raw: {},
};

describe('item version preview query', () => {
  it('exposes history while publishing and author enrichment are still loading', async () => {
    const loadItemVersions = vi.fn<ItemVersionApi['loadItemVersions']>(() =>
      Effect.succeed([
        {
          number: 2,
          savedAt: '2026-09-22T10:00:00.000Z',
          item: { ...currentItem, fields: { title: 'Version two' }, metadata: { version: 2 } },
        },
      ]),
    );
    const loadItemPublishings = vi.fn<ItemVersionApi['loadItemPublishings']>(() => Effect.never);
    const loadInstanceUsers = vi.fn<ItemVersionApi['loadInstanceUsers']>(() => Effect.never);
    const api: ItemVersionApi = {
      loadItemVersions,
      loadItemPublishings,
      loadInstanceUsers,
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result, unmount } = renderHook(
      () =>
        useItemVersionPreview({
          api,
          reference,
          currentItem,
          sessionToken: 'session-token',
          credentialRevision: 'test-credentials',
        }),
      { wrapper: queryClientWrapper(client) },
    );

    await waitFor(() => expect(result.current.options.map(({ number }) => number)).toEqual([2, 1]));
    expect(result.current.history.isLoading).toBe(false);
    expect(result.current.publishings.isLoading).toBe(true);
    expect(result.current.authors.isLoading).toBe(true);
    expect(loadItemVersions).toHaveBeenCalledOnce();
    expect(loadItemPublishings).toHaveBeenCalledOnce();
    expect(loadInstanceUsers).toHaveBeenCalledOnce();

    act(() => result.current.selectVersion(2));
    expect(result.current.selectedItem.fields.title).toBe('Version two');
    unmount();
  });
});
