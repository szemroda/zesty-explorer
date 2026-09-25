import type { Effect } from 'effect';
import type {
  CodeFileList,
  CodeState,
  CollectionReference,
  CollectionCatalog,
  CollectionSchema,
  CollectionSnapshot,
  ContentItemReference,
  ContentItemVersion,
  ContentState,
  ExplorerError,
  InstanceReference,
  InstanceUser,
  ItemPublishing,
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

export interface CollectionApi {
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

export interface ItemVersionApi {
  loadItemVersions(
    reference: ContentItemReference,
    sessionToken: string,
  ): Effect.Effect<readonly ContentItemVersion[], ExplorerError>;
  loadItemPublishings(
    reference: ContentItemReference,
    sessionToken: string,
  ): Effect.Effect<readonly ItemPublishing[], ExplorerError>;
  loadInstanceUsers(
    reference: InstanceReference,
    sessionToken: string,
  ): Effect.Effect<readonly InstanceUser[], ExplorerError>;
}

export interface CodeFileApi {
  /** Lists every `/web/views` file with its source in one code state. */
  loadCodeFiles(
    reference: InstanceReference,
    state: CodeState,
    sessionToken: string,
  ): Effect.Effect<CodeFileList, ExplorerError>;
}

export interface ZestyApi extends CollectionApi, ItemVersionApi, CodeFileApi {}

export interface ZestyApiOptions {
  readonly pageSize?: number;
  readonly collectionLimit?: number;
  readonly timeoutMs?: number;
  readonly retryDelaysMs?: readonly number[];
}
