import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { ContentItem, ContentItemReference } from '../../domain';
import type { ItemVersionApi } from '../../zesty-api';
import { memoryCooldownStorage, memoryRequestSlots } from '../../test/request-budget';
import { createRequestBudget } from '../../zesty-api/request-budget';
import { refreshActivePublicationStatuses } from '../hooks/publication-status-query';
import { PublicationStatusCell, PublicationStatusProvider } from './PublicationStatusCell';

const item: ContentItem = {
  id: '7-example',
  fields: { title: 'Example' },
  metadata: { version: 8 },
  raw: {},
};
const reference: ContentItemReference = {
  instanceZuid: '8-instance',
  modelZuid: '6-model',
  itemZuid: item.id,
  deployment: 'production',
  area: 'content',
  apiBaseUrl: 'https://8-instance.api.zesty.io/v1',
  managerBaseUrl: 'https://8-instance.manager.zesty.io',
};

function renderCell(api: ItemVersionApi) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PublicationStatusProvider api={api} sessionToken="token" credentialRevision="revision">
        <PublicationStatusCell item={item} reference={reference} />
      </PublicationStatusProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('publication status cell', () => {
  it('shows version-only badges for saved, published, and scheduled versions', async () => {
    const authors = vi.fn(() => Effect.succeed([]));
    renderCell({
      loadItemVersions: () =>
        Effect.succeed(
          [5, 7, 8].map((number) => ({ number, item: { ...item, metadata: { version: number } } })),
        ),
      loadItemPublishings: () =>
        Effect.succeed([
          { version: 5, active: true },
          { version: 7, active: false, publishAt: '2099-10-01T12:00:00Z' },
        ]),
      loadInstanceUsers: authors,
    });

    expect(await screen.findByRole('img', { name: 'Latest saved version v8' })).toHaveTextContent(
      'v8',
    );
    expect(screen.getByRole('img', { name: 'Currently published version v5' })).toHaveTextContent(
      'v5',
    );
    expect(screen.getByRole('img', { name: /Version v7 scheduled to publish/ })).toHaveTextContent(
      'v7',
    );
    expect(authors).not.toHaveBeenCalled();
  });

  it('does not mistake a publishing failure for an unpublished item and can retry', async () => {
    const publishings = vi
      .fn()
      .mockReturnValueOnce(Effect.fail({ kind: 'network', message: 'Network unavailable.' }))
      .mockReturnValue(Effect.succeed([]));
    renderCell({
      loadItemVersions: () => Effect.succeed([{ number: 8, item }]),
      loadItemPublishings: publishings,
      loadInstanceUsers: () => Effect.succeed([]),
    });

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Latest saved/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: 'Latest saved version v8' })).toBeInTheDocument();
    expect(publishings).toHaveBeenCalledTimes(2);
  });

  it('reloads the visible status when Refresh is used', async () => {
    let version = 8;
    const client = renderCell({
      loadItemVersions: () => Effect.sync(() => [{ number: version, item }]),
      loadItemPublishings: () => Effect.succeed([]),
      loadInstanceUsers: () => Effect.succeed([]),
    });

    expect(await screen.findByRole('img', { name: 'Latest saved version v8' })).toBeInTheDocument();
    version = 9;
    expect(await refreshActivePublicationStatuses(client)).toBe(true);
    expect(await screen.findByRole('img', { name: 'Latest saved version v9' })).toBeInTheDocument();
  });

  it('loads the rows opened last first, and the rows of one render in order', async () => {
    const takeSlot = memoryRequestSlots(1);
    const release = await takeSlot(new AbortController().signal);
    const budget = createRequestBudget({
      takeSlot,
      storage: memoryCooldownStorage(),
      intervalMs: 0,
    });
    const loaded: string[] = [];
    const api: ItemVersionApi = {
      loadItemVersions: (itemReference) =>
        budget.run('instances', () =>
          Effect.sync(() => {
            loaded.push(itemReference.itemZuid);
            return [{ number: 8, item }];
          }),
        ),
      loadItemPublishings: () => budget.run('instances', () => Effect.succeed([])),
      loadInstanceUsers: () => Effect.succeed([]),
    };
    const client = new QueryClient();
    type Row = ContentItemReference['itemZuid'];
    const table = (name: string, ids: readonly Row[]) =>
      ids.map((id) => (
        <PublicationStatusCell
          key={`${name}-${id}`}
          item={item}
          reference={{ ...reference, itemZuid: id }}
        />
      ));
    const view = (root: readonly Row[], nested: readonly Row[]) => (
      <QueryClientProvider client={client}>
        <PublicationStatusProvider api={api} sessionToken="token" credentialRevision="revision">
          {table('root', root)}
          {table('nested', nested)}
        </PublicationStatusProvider>
      </QueryClientProvider>
    );
    const root: Row[] = ['7-root-1', '7-root-2', '7-root-3'];
    // A root page renders while every slot is busy. A later render opens nested rows, one of
    // which is already queued for the root page.
    const { rerender } = render(view(root, []));
    await act(() => Promise.resolve());
    rerender(view(root, ['7-nested-1', '7-root-3', '7-nested-2']));
    await act(() => Promise.resolve());
    release();

    await vi.waitFor(() => expect(loaded).toHaveLength(5));
    expect(loaded).toEqual(['7-root-3', '7-nested-1', '7-nested-2', '7-root-1', '7-root-2']);
  });

  it('keeps separate badges when the latest version is also published', async () => {
    renderCell({
      loadItemVersions: () => Effect.succeed([{ number: 8, item }]),
      loadItemPublishings: () => Effect.succeed([{ version: 8, active: true }]),
      loadInstanceUsers: () => Effect.succeed([]),
    });

    expect(await screen.findByRole('img', { name: 'Latest saved version v8' })).toHaveTextContent(
      'v8',
    );
    expect(screen.getByRole('img', { name: 'Currently published version v8' })).toHaveTextContent(
      'v8',
    );
  });
});
