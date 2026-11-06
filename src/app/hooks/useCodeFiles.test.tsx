import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { CodeState, ExplorerError, InstanceReference, PreviewLock } from '../../domain';
import { queryClientWrapper } from '../../test/fixtures';
import type { CodeFileApi } from '../../zesty-api';
import { useWebEngineBaseUrls } from './useCodeFiles';

const instance: InstanceReference = {
  instanceZuid: '8-instance',
  deployment: 'production',
  apiBaseUrl: 'https://8-instance.api.zesty.io/v1',
  managerBaseUrl: 'https://8-instance.manager.zesty.io',
};
const denied: ExplorerError = {
  kind: 'permission',
  status: 403,
  message: 'Your Zesty session cannot read this instance’s settings.',
};

function renderHosts(state: CodeState, loadPreviewLock: CodeFileApi['loadPreviewLock']) {
  const api: CodeFileApi = {
    loadCodeFiles: () => Effect.never,
    loadCodeFileVersions: () => Effect.never,
    loadWebEngineBaseUrls: () => Effect.succeed(['https://h4sh-dev.webengine.zesty.io']),
    loadPreviewLock,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(
    () =>
      useWebEngineBaseUrls({
        api,
        instance,
        state,
        credentials: { revision: 'test', sessionToken: 'session-token' },
        enabled: true,
      }),
    { wrapper: queryClientWrapper(client) },
  );
}

describe('WebEngine hosts query', () => {
  it('drops the cached preview password once a refresh fails', async () => {
    const outcomes: Effect.Effect<PreviewLock, ExplorerError>[] = [
      Effect.succeed({ kind: 'password', password: 'old' }),
      Effect.fail(denied),
    ];
    const { result } = renderHosts('latest', () => outcomes.shift()!);
    await waitFor(() =>
      expect(result.current.previewLock).toEqual({ kind: 'password', password: 'old' }),
    );

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.previewLockError).toEqual(denied));
    expect(result.current.previewLock).toBeUndefined();
  });

  it('never locks published code or reads the settings for it', async () => {
    const loadPreviewLock = vi.fn<CodeFileApi['loadPreviewLock']>(() =>
      Effect.succeed({ kind: 'password', password: 'secret' }),
    );
    const { result } = renderHosts('published', loadPreviewLock);

    await waitFor(() => expect(result.current.baseUrls).toBeDefined());
    expect(result.current.previewLock).toEqual({ kind: 'off' });
    expect(loadPreviewLock).not.toHaveBeenCalled();
  });
});
