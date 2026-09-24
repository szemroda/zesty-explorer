import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CollectionNode, ModelZuid } from '../domain';

// A collection node in the synthetic `8-fixture-instance` with default presentation.
export function collectionNode(
  id: CollectionNode['id'],
  modelZuid: ModelZuid,
  children: readonly CollectionNode[] = [],
): CollectionNode {
  return {
    id,
    name: id,
    reference: {
      instanceZuid: '8-fixture-instance',
      modelZuid,
      deployment: 'production',
      area: 'content',
      apiBaseUrl: 'https://8-fixture-instance.api.zesty.io/v1',
      managerBaseUrl: 'https://8-fixture-instance.manager.zesty.io',
    },
    presentation: {
      visibleColumns: ['*'],
      columnWidths: {},
      sort: { fieldPath: ['modified'], direction: 'desc' },
      filters: [],
      freeText: '',
    },
    children,
  };
}

// A `renderHook` wrapper that provides the given query client.
export function queryClientWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
