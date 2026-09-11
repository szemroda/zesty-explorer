export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type InstanceZuid = Brand<string, 'InstanceZuid'>;
export type ModelZuid = Brand<string, 'ModelZuid'>;
export type ItemZuid = Brand<string, 'ItemZuid'>;
export type FieldZuid = Brand<string, 'FieldZuid'>;
export type CollectionNodeId = Brand<string, 'CollectionNodeId'>;
export type SnapshotId = Brand<string, 'SnapshotId'>;

export type Deployment = 'production' | 'stage' | 'development';
export type CollectionArea = 'content' | 'blocks';
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

export interface ContentItem {
  readonly id: ItemZuid;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly raw: Readonly<Record<string, unknown>>;
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
      readonly parentField: FieldPath;
      readonly targetModelZuid: ModelZuid;
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
  readonly version: 1;
  readonly root: CollectionNode;
  readonly contentState: ContentState;
  readonly viewFilters: readonly ViewFilter[];
  readonly globalFreeText: string;
}

export type ExplorerError =
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
