import type { Effect } from 'effect';
import type {
  CollectionReference,
  CollectionCatalog,
  CollectionSchema,
  CollectionSnapshot,
  ContentState,
  ExplorerError,
  InstanceReference,
} from '../domain';

export interface ZestyTransportRequest {
  readonly method: 'GET';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ZestyTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export type ZestyTransportError = { readonly kind: 'network' };

export interface ZestyTransport {
  request(
    request: ZestyTransportRequest,
  ): Effect.Effect<ZestyTransportResponse, ZestyTransportError>;
}

export interface ZestyApi {
  loadCollectionCatalog(
    reference: InstanceReference,
    sessionToken: string,
  ): Effect.Effect<CollectionCatalog, ExplorerError>;
  loadCollectionSchema(
    reference: CollectionReference,
    sessionToken: string,
  ): Effect.Effect<CollectionSchema, ExplorerError>;
  loadCollectionSnapshot(
    reference: CollectionReference,
    state: ContentState,
    sessionToken: string,
    itemLimit?: number,
  ): Effect.Effect<CollectionSnapshot, ExplorerError>;
}

export interface ZestyApiOptions {
  readonly pageSize?: number;
  readonly collectionLimit?: number;
  readonly timeoutMs?: number;
  readonly retryDelaysMs?: readonly number[];
}
