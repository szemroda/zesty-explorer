import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeFile, CodeFileZuid, CodeState, InstanceReference } from '../../domain';
import type { WebEngineBaseUrlsResult } from '../hooks/useCodeFiles';
import { EndpointRequest } from './EndpointRequest';

const instance: InstanceReference = {
  instanceZuid: '8-fixture',
  deployment: 'production',
  apiBaseUrl: 'https://8-fixture.api.zesty.io/v1',
  managerBaseUrl: 'https://8-fixture.manager.zesty.io',
};
const preview = 'https://h4sh-dev.webengine.zesty.io';
// The preview host for latest code; published code has no live domain.
const hosts = (state: CodeState): WebEngineBaseUrlsResult => ({
  baseUrls: state === 'latest' ? [preview] : [],
  error: undefined,
  refresh: () => {},
});
const helpers: CodeFile = {
  id: '11-helpers',
  fileName: 'helpers',
  type: 'snippet',
  code: '{{get_var.debug}}',
  version: 1,
};

// Forms outlive the panel, so each test uses its own endpoint.
function endpoint(id: CodeFileZuid, code: string): CodeFile {
  return { id, fileName: '/data/list.json', type: 'ajax-json', code, version: 1 };
}

function renderPanel(file: CodeFile, state: CodeState = 'latest') {
  const panel = (current: CodeFile) => (
    <EndpointRequest
      instance={instance}
      state={state}
      file={current}
      files={[current, helpers]}
      hosts={hosts(state)}
    >
      <p>Source view</p>
    </EndpointRequest>
  );
  const view = render(panel(file));
  return { ...view, rerenderWith: (next: CodeFile) => view.rerender(panel(next)) };
}

const newTabLink = () => screen.getByRole('link', { name: 'Open in a new tab' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EndpointRequest', () => {
  it('sends only added parameters, keeps empty ones, and shows the response of the sent URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response('\n\n{"items":[1]}', { headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    renderPanel(endpoint('11-send', '{{get_var.limit}}{{include helpers}}'));

    expect(newTabLink()).toHaveAttribute('href', `${preview}/data/list.json`);
    fireEvent.click(screen.getByRole('button', { name: 'Add ?limit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Value of ?limit' }), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add ?debug' }));
    const sent = `${preview}/data/list.json?limit=5&debug=`;
    expect(newTabLink()).toHaveAttribute('href', sent);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const response = screen.getByRole('region', { name: 'Response' });
    await waitFor(() => expect(response).toHaveTextContent('200'));
    expect(fetch).toHaveBeenCalledWith(sent, expect.objectContaining({ credentials: 'omit' }));
    expect(screen.getByTestId('response-body')).toHaveTextContent('{ "items": [ 1 ] }');

    fireEvent.change(screen.getByRole('textbox', { name: 'Value of ?limit' }), {
      target: { value: '6' },
    });
    expect(response).toHaveTextContent(sent);
    expect(screen.queryByText('Source view')).not.toBeInTheDocument();
  });

  it('restores its form, and a refreshed source only adds new suggestions', () => {
    const file = endpoint('11-restore', '{{get_var.limit}}');
    const first = renderPanel(file);
    fireEvent.click(screen.getByRole('button', { name: 'Add ?limit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Value of ?limit' }), {
      target: { value: '5' },
    });
    first.unmount();

    const second = renderPanel(file);
    expect(newTabLink()).toHaveAttribute('href', `${preview}/data/list.json?limit=5`);
    second.rerenderWith({ ...file, code: '{{get_var.page}}' });
    expect(screen.getByRole('button', { name: 'Add ?page' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add ?limit' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Value of ?limit' })).toHaveValue('5');
  });

  it('blocks Send with a reason when published code has no live domain', () => {
    renderPanel(endpoint('11-published', '{{get_var.limit}}'), 'published');

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This instance has no live domain, so its published endpoints have no address.',
    );
  });

  it('does not send to cached origins after their lookup failed', () => {
    render(
      <EndpointRequest
        instance={instance}
        state="latest"
        file={endpoint('11-lookup', '')}
        files={[]}
        hosts={{
          baseUrls: [preview],
          error: { kind: 'network', message: 'Zesty could not be reached.' },
          refresh: () => {},
        }}
      >
        <p>Source view</p>
      </EndpointRequest>,
    );

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Zesty Explorer could not look up the preview host of this instance.',
    );
  });

  it('cancels a pending request and keeps the previous state', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<never>(() => {});
    });
    renderPanel(endpoint('11-cancel', ''));

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);

    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.getByRole('region', { name: 'Response' })).toHaveTextContent(
      'send the request to see its response here',
    );
  });
});
