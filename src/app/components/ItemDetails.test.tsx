import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Effect } from 'effect';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ContentItem, ContentItemReference } from '../../domain';
import type { ItemVersionApi } from '../../zesty-api';
import { ItemDetails } from './ItemDetails';

const reference: ContentItemReference = {
  instanceZuid: '8-instance',
  modelZuid: '6-model',
  itemZuid: '7-item',
  deployment: 'production',
  area: 'content',
  apiBaseUrl: 'https://8-instance.api.zesty.io/v1',
  managerBaseUrl: 'https://8-instance.manager.zesty.io',
};

const currentItem: ContentItem = {
  id: '7-item',
  fields: { title: 'Current title' },
  metadata: { version: 1 },
  raw: { title: 'Current raw title' },
};

function renderDetails(api: ItemVersionApi, onAuthenticationFailure = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ItemDetails
        api={api}
        reference={reference}
        sessionToken="session-token"
        credentialRevision="test-credentials"
        item={currentItem}
        finalFocus={createRef<HTMLElement>()}
        onClose={vi.fn()}
        onAuthenticationFailure={onAuthenticationFailure}
      />
    </QueryClientProvider>,
  );
}

describe('ItemDetails version preview', () => {
  it('keeps the current item in the preview while history gates the version list', () => {
    const pendingApi: ItemVersionApi = {
      loadItemVersions: () => Effect.never,
      loadItemPublishings: () => Effect.never,
      loadInstanceUsers: () => Effect.never,
    };

    renderDetails(pendingApi);

    const history = screen.getByRole('region', { name: 'Saved versions' });
    expect(within(history).getByRole('status')).toHaveTextContent('Loading saved versions');
    expect(within(history).queryByRole('button', { name: /Version 1/ })).not.toBeInTheDocument();
    expect(
      within(history).queryByText('No saved versions match this search.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Version 1' })).toBeInTheDocument();
  });

  it('switches fields and raw JSON together and shows enriched version statuses', async () => {
    const historical: ContentItem = {
      ...currentItem,
      fields: { title: 'Historical title' },
      metadata: { version: 2 },
      raw: { title: 'Historical raw title' },
    };
    const api: ItemVersionApi = {
      loadItemVersions: () =>
        Effect.succeed([
          {
            number: 2,
            savedAt: '2026-09-22T12:35:00.000Z',
            authorZuid: '5-author',
            item: historical,
          },
        ]),
      loadItemPublishings: () =>
        Effect.succeed([
          { version: 2, active: true },
          {
            version: 2,
            active: false,
            publishAt: '2099-09-26T07:30:00.000Z',
          },
        ]),
      loadInstanceUsers: () =>
        Effect.succeed([{ id: '5-author', firstName: 'Anna', lastName: 'Kowalska' }]),
    };
    renderDetails(api);

    const history = await screen.findByRole('region', { name: 'Saved versions' });
    const versionTwo = await within(history).findByRole('button', { name: /Version 2/ });
    expect(within(versionTwo).getByText('Latest saved')).toBeInTheDocument();
    expect(within(versionTwo).getByText('Currently published')).toBeInTheDocument();
    expect(within(versionTwo).getByText('Scheduled')).toBeInTheDocument();
    expect(within(versionTwo).getByText(/Anna Kowalska/)).toBeInTheDocument();

    fireEvent.click(versionTwo);
    expect(screen.getByRole('heading', { name: 'Version 2' })).toBeInTheDocument();
    expect(screen.getByText('Historical title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Raw JSON' }));
    expect(screen.getByText(/Historical raw title/)).toBeInTheDocument();
    expect(screen.queryByText(/Current raw title/)).not.toBeInTheDocument();
  });

  it('shows safe diagnostics for a failed source and reports authentication failures', async () => {
    const onAuthenticationFailure = vi.fn();
    renderDetails(
      {
        loadItemVersions: () => Effect.succeed([]),
        loadItemPublishings: () => Effect.succeed([]),
        loadInstanceUsers: () =>
          Effect.fail({
            kind: 'authentication',
            status: 401,
            message: 'The session expired.',
            diagnostic: { operation: 'load-instance-users', responseStatus: 401 },
          }),
      },
      onAuthenticationFailure,
    );

    expect(await screen.findByText('Authors could not load.')).toBeInTheDocument();
    expect(
      screen.getByText('Copy a fresh deployment-specific cookie from Zesty Manager.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(screen.getByLabelText('Technical error details')).toHaveTextContent('HTTP status: 401');
    await waitFor(() => expect(onAuthenticationFailure).toHaveBeenCalled());
  });
});
