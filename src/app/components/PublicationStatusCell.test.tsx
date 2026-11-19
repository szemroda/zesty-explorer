import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type {
  ContentItem,
  ContentItemReference,
  ContentState,
  ItemZuid,
  ModelPublishing,
} from '../../domain';
import { memoryCooldownStorage, memoryRequestSlots } from '../../test/request-budget';
import { createRequestBudget } from '../../zesty-api/request-budget';
import { refreshActiveModelPublications } from '../hooks/model-publications-query';
import {
  refreshActivePublicationStatuses,
  type PublicationStatusSource,
} from '../hooks/publication-status-query';
import { PublicationStatusCell, PublicationStatusProvider } from './PublicationStatusCell';

type StatusApi = PublicationStatusSource['api'];

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

/** A live record of `version` that started in the past, and a record that is still to come. */
const live = (version: number, itemZuid: ItemZuid = item.id): ModelPublishing => ({
  itemZuid,
  version,
  publishAt: '2026-01-01T00:00:00Z',
});
const upcoming = (version: number): ModelPublishing => ({
  itemZuid: item.id,
  version,
  publishAt: '2099-10-01T12:00:00Z',
});

function statusApi(overrides: Partial<StatusApi>): StatusApi {
  return {
    loadItemVersions: () => Effect.succeed([]),
    loadItemPublishings: () => Effect.die('Badges read the model publications.'),
    loadInstanceUsers: () => Effect.succeed([]),
    loadModelPublishings: () => Effect.succeed([]),
    ...overrides,
  };
}

function renderCell(api: StatusApi, contentState: ContentState = 'published') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PublicationStatusProvider
        api={api}
        sessionToken="token"
        credentialRevision="revision"
        contentState={contentState}
      >
        <PublicationStatusCell item={item} reference={reference} />
      </PublicationStatusProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('publication status cell', () => {
  it('shows version-only badges for saved, published, and scheduled versions', async () => {
    renderCell(
      statusApi({
        loadItemVersions: () =>
          Effect.succeed(
            [5, 7, 8].map((number) => ({
              number,
              item: { ...item, metadata: { version: number } },
            })),
          ),
        loadModelPublishings: () =>
          Effect.succeed([
            { ...live(4), unpublishAt: '2026-02-01T00:00:00Z' },
            live(5),
            upcoming(7),
          ]),
      }),
    );

    expect(await screen.findByRole('img', { name: 'Latest saved version v8' })).toHaveTextContent(
      /^v8$/,
    );
    expect(screen.getByRole('img', { name: 'Currently published version v5' })).toHaveTextContent(
      /^v5$/,
    );
    expect(screen.getByRole('img', { name: /Version v7 scheduled to publish/ })).toHaveTextContent(
      /^v7$/,
    );
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  it('reads every latest saved row of a model from one request', async () => {
    const loadModelPublishings = vi.fn<StatusApi['loadModelPublishings']>(() =>
      Effect.succeed([live(5, '7-row-1'), live(3, '7-row-2'), live(9, '7-other-model-row')]),
    );
    const rows = [
      { ...item, id: '7-row-1' as const, metadata: { version: 8 } },
      { ...item, id: '7-row-2' as const, metadata: { version: 3 } },
      { ...item, id: '7-row-3' as const, metadata: { version: 1 } },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PublicationStatusProvider
          api={statusApi({
            loadItemVersions: () => Effect.die('A latest view has no per-item requests.'),
            loadModelPublishings,
          })}
          sessionToken="token"
          credentialRevision="revision"
          contentState="latest"
        >
          {rows.map((row) => (
            <div key={row.id} data-testid={row.id}>
              <PublicationStatusCell item={row} reference={{ ...reference, itemZuid: row.id }} />
            </div>
          ))}
        </PublicationStatusProvider>
      </QueryClientProvider>,
    );

    const badges = async (row: string) =>
      (await within(screen.getByTestId(row)).findAllByRole('img')).map((badge) =>
        badge.getAttribute('aria-label'),
      );
    expect(await badges('7-row-1')).toEqual([
      'Latest saved version v8',
      'Currently published version v5',
    ]);
    expect(await badges('7-row-2')).toEqual([
      'Version v3 is the latest saved and currently published version',
    ]);
    expect(await badges('7-row-3')).toEqual(['Latest saved version v1']);
    expect(loadModelPublishings.mock.calls.map(([model]) => model.modelZuid)).toEqual(['6-model']);
  });

  it('does not mistake a publishing failure for an unpublished item and can retry', async () => {
    const loadModelPublishings = vi
      .fn<StatusApi['loadModelPublishings']>()
      .mockReturnValueOnce(Effect.fail({ kind: 'network', message: 'Network unavailable.' }))
      .mockReturnValue(Effect.succeed([]));
    renderCell(statusApi({ loadModelPublishings }), 'latest');

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Latest saved/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: 'Latest saved version v8' })).toBeInTheDocument();
  });

  it('shows a publish made in Zesty after Refresh', async () => {
    let records = [live(5)];
    const client = renderCell(
      statusApi({ loadModelPublishings: () => Effect.sync(() => records) }),
      'latest',
    );

    expect(
      await screen.findByRole('img', { name: 'Currently published version v5' }),
    ).toBeInTheDocument();
    records = [{ ...live(5), unpublishAt: '2026-02-01T00:00:00Z' }, live(8)];
    expect(await refreshActiveModelPublications(client)).toBe(true);
    expect(
      await screen.findByRole('img', {
        name: 'Version v8 is the latest saved and currently published version',
      }),
    ).toBeInTheDocument();
  });

  it('reloads the visible saved versions when Refresh is used', async () => {
    let version = 8;
    const client = renderCell(
      statusApi({ loadItemVersions: () => Effect.sync(() => [{ number: version, item }]) }),
    );

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
    const api = statusApi({
      loadItemVersions: (itemReference) =>
        budget.run('instances', () =>
          Effect.sync(() => {
            loaded.push(itemReference.itemZuid);
            return [{ number: 8, item }];
          }),
        ),
    });
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
        <PublicationStatusProvider
          api={api}
          sessionToken="token"
          credentialRevision="revision"
          contentState="published"
        >
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

  it('sends each saved-versions request once per Refresh when Refresh is used again before it starts', async () => {
    const takeSlot = memoryRequestSlots(1);
    const budget = createRequestBudget({
      takeSlot,
      storage: memoryCooldownStorage(),
      intervalMs: 0,
    });
    const sent: string[] = [];
    const api = statusApi({
      loadItemVersions: (itemReference) =>
        budget.run('instances', () =>
          Effect.sync(() => {
            sent.push(itemReference.itemZuid);
            return [{ number: 8, item }];
          }),
        ),
    });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <PublicationStatusProvider
          api={api}
          sessionToken="token"
          credentialRevision="revision"
          contentState="published"
        >
          {(['7-row-1', '7-row-2'] as const).map((id) => (
            <PublicationStatusCell
              key={id}
              item={item}
              reference={{ ...reference, itemZuid: id }}
            />
          ))}
        </PublicationStatusProvider>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    // Every slot is busy, so both refreshes are still queued when the second one is used.
    const release = await takeSlot(new AbortController().signal);
    const first = refreshActivePublicationStatuses(client);
    await act(() => Promise.resolve());
    const second = refreshActivePublicationStatuses(client);
    await act(() => Promise.resolve());
    release();

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(sent).toEqual(['7-row-1', '7-row-2', '7-row-1', '7-row-2']);
  });

  it('shows one badge when the latest saved version is also published', async () => {
    renderCell(
      statusApi({
        loadItemVersions: () => Effect.succeed([{ number: 8, item }]),
        loadModelPublishings: () => Effect.succeed([live(8)]),
      }),
    );

    expect(
      await screen.findByRole('img', {
        name: 'Version v8 is the latest saved and currently published version',
      }),
    ).toHaveTextContent(/^v8$/);
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('shows a scheduled latest version once, as scheduled', async () => {
    renderCell(
      statusApi({ loadModelPublishings: () => Effect.succeed([live(5), upcoming(8)]) }),
      'latest',
    );

    expect(
      await screen.findByRole('img', { name: /^Latest saved version v8 scheduled to publish/ }),
    ).toHaveTextContent(/^v8$/);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});
