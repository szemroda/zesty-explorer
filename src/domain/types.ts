export type InstanceZuid = `8-${string}`;
export type ModelZuid = `6-${string}`;
export type ItemZuid = `7-${string}`;
export type FieldZuid = `12-${string}`;
export type UserZuid = `5-${string}` | `55-${string}`;
export type CollectionNodeId = `node-${string}`;
export type SnapshotId = `snapshot-${string}`;

export type Deployment = 'production' | 'stage' | 'development';
export type CollectionArea = 'content' | 'blocks' | 'other';
export type ContentState = 'latest' | 'published';
export type Scalar = string | number | boolean;
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CollectionReference {
  readonly instanceZuid: InstanceZuid;
  readonly modelZuid: ModelZuid;
  readonly itemZuid?: ItemZuid;
  readonly deployment: Deployment;
  readonly area: CollectionArea;
  readonly apiBaseUrl: string;
  readonly managerBaseUrl: string;
}

export type ContentItemReference = Omit<CollectionReference, 'itemZuid'> & {
  readonly itemZuid: ItemZuid;
};

export interface InstanceReference {
  readonly instanceZuid: InstanceZuid;
  readonly deployment: Deployment;
  readonly apiBaseUrl: string;
  readonly managerBaseUrl: string;
  readonly suggestedModelZuid?: ModelZuid;
  readonly suggestedItemZuid?: ItemZuid;
  readonly suggestedArea?: CollectionArea;
}

export type CollectionCatalogGroup = 'content' | 'blocks' | 'other';

export interface CollectionCatalogEntry {
  readonly label: string;
  readonly name: string;
  readonly type: string;
  readonly group: CollectionCatalogGroup;
  readonly reference: CollectionReference;
}

export interface CollectionCatalog {
  readonly collections: readonly CollectionCatalogEntry[];
  readonly incomplete: boolean;
  readonly warning?: ExplorerError;
}

export interface ContentItem {
  readonly id: ItemZuid;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ContentItemVersion {
  readonly number: number;
  readonly savedAt?: string;
  readonly authorZuid?: UserZuid;
  readonly item: ContentItem;
}

export interface ItemPublishing {
  readonly version: number;
  readonly publishAt?: string;
  readonly unpublishAt?: string;
  readonly active: boolean;
}

export interface InstanceUser {
  readonly id: UserZuid;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
}

export interface CollectionSnapshot {
  readonly id: SnapshotId;
  readonly instanceZuid: InstanceZuid;
  readonly modelZuid: ModelZuid;
  readonly state: ContentState;
  readonly language: 'en-US';
  readonly items: readonly ContentItem[];
  readonly itemsById: ReadonlyMap<ItemZuid, ContentItem>;
  readonly partial: boolean;
}

export interface CollectionPage {
  readonly items: readonly ContentItem[];
  readonly totalResults: number;
  readonly page: number;
  readonly limit: number;
}

export type FieldKind = 'text' | 'number' | 'date' | 'boolean' | 'relationship' | 'structured';

export interface CollectionField {
  readonly id: FieldZuid;
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly relatedModelZuid?: ModelZuid;
  readonly options?: readonly Scalar[];
}

export interface CollectionSchema {
  readonly modelZuid: ModelZuid;
  readonly label: string;
  readonly fields: readonly CollectionField[];
}

export type FieldPath = readonly string[];

export type RelationshipDefinition =
  | {
      readonly kind: 'native';
      readonly fieldSide: 'parent' | 'child';
      readonly field: FieldPath;
      readonly relatedModelZuid: ModelZuid;
    }
  | {
      readonly kind: 'custom';
      readonly parentField: FieldPath;
      readonly childField: FieldPath;
    };

export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'starts-with'
  | 'not-equal'
  | 'greater-than'
  | 'less-than'
  | 'between'
  | 'is-empty'
  | 'is-not-empty'
  | 'true'
  | 'false'
  | 'one-of';

export interface ViewFilter {
  readonly id: string;
  readonly nodePath: readonly CollectionNodeId[];
  readonly fieldPath: FieldPath;
  readonly operator: FilterOperator;
  readonly value?: unknown;
  readonly invalid?: boolean;
}

export interface SortState {
  readonly fieldPath: FieldPath;
  readonly direction: 'asc' | 'desc';
}

export interface NodePresentation {
  readonly visibleColumns: readonly string[];
  readonly statusColumnHidden?: boolean;
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly sort: SortState;
  readonly filters: readonly ViewFilter[];
  readonly freeText: string;
}

export interface CollectionNode {
  readonly id: CollectionNodeId;
  readonly name: string;
  readonly reference: Omit<CollectionReference, 'itemZuid'>;
  readonly relationship?: RelationshipDefinition;
  readonly presentation: NodePresentation;
  readonly children: readonly CollectionNode[];
}

export interface PersistedView {
  readonly version: 2;
  readonly root: CollectionNode;
  readonly contentState: ContentState;
  readonly viewFilters: readonly ViewFilter[];
  readonly globalFreeText: string;
}

export type ExplorerRequestOperation =
  | 'load-collection-catalog'
  | 'load-collection-schema'
  | 'load-collection-items'
  | 'load-item-versions'
  | 'load-item-publishings'
  | 'load-instance-users';

declare const safeRequestUrlBrand: unique symbol;
export type SafeRequestUrl = string & { readonly [safeRequestUrlBrand]: true };

export interface ExplorerDecodingIssue {
  readonly path: string;
  readonly expected: string;
  readonly received: string;
}

export interface ExplorerErrorDiagnostic {
  readonly operation?: ExplorerRequestOperation;
  readonly requestUrl?: SafeRequestUrl;
  readonly responseStatus?: number;
  readonly issues?: readonly ExplorerDecodingIssue[];
  readonly issuesOmitted?: boolean;
}

type ExplorerErrorKind =
  | { readonly kind: 'invalid-input'; readonly message: string }
  | { readonly kind: 'blocked-host'; readonly message: string }
  | { readonly kind: 'authentication'; readonly message: string; readonly status: 401 }
  | { readonly kind: 'permission'; readonly message: string; readonly status: 403 }
  | { readonly kind: 'missing-resource'; readonly message: string; readonly status: 404 }
  | { readonly kind: 'decoding'; readonly message: string }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'timeout'; readonly message: string }
  | { readonly kind: 'rate-limit'; readonly message: string; readonly retryAfterMs?: number }
  | { readonly kind: 'server'; readonly message: string; readonly status: number }
  | { readonly kind: 'data-limit'; readonly message: string; readonly scope: 'collection' | 'view' }
  | { readonly kind: 'cancelled'; readonly message: string };

export type ExplorerError = ExplorerErrorKind & {
  readonly diagnostic?: ExplorerErrorDiagnostic;
};
