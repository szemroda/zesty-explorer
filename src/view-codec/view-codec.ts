import { Either, Schema } from 'effect';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { parseCollectionReference } from '../collection-reference';
import type {
  CollectionNode,
  PersistedView,
  RelationshipDefinition,
  SortState,
  ViewFilter,
} from '../domain';
import { validateCollectionTree } from '../explorer-core/collection-tree';

const VersionedViewSchema = Schema.Struct({
  version: Schema.Literal(1),
  root: Schema.Unknown,
  contentState: Schema.Union(Schema.Literal('latest'), Schema.Literal('published')),
  viewFilters: Schema.Array(Schema.Unknown),
  globalFreeText: Schema.String,
});

const forbiddenKeys = new Set([
  'token',
  'sessionToken',
  'APP_SID',
  'STAGE_APP_SID',
  'DEV_APP_SID',
  'authorization',
  'expandedRows',
  'page',
  'pageSize',
  'openPanel',
  'loading',
  'requestState',
]);
const maximumEncodedLength = 100_000;
const maximumDecodedLength = 1_000_000;

export type ViewDecodeResult =
  | { readonly ok: true; readonly view: PersistedView }
  | { readonly ok: false; readonly raw: string; readonly reason: string };

function assertNonSecretState(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNonSecretState);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      throw new Error(`Only settled non-secret view state may be encoded. Found ${key}.`);
    }
    assertNonSecretState(child);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFieldPath(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.length > 0 && value.every(Boolean);
}

function isSortState(value: unknown): value is SortState {
  return (
    isRecord(value) &&
    isFieldPath(value.fieldPath) &&
    (value.direction === 'asc' || value.direction === 'desc')
  );
}

const filterOperators = new Set([
  'contains',
  'equals',
  'starts-with',
  'not-equal',
  'greater-than',
  'less-than',
  'between',
  'is-empty',
  'is-not-empty',
  'true',
  'false',
  'one-of',
]);

function isViewFilter(value: unknown): value is ViewFilter {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStringArray(value.nodePath) &&
    isFieldPath(value.fieldPath) &&
    typeof value.operator === 'string' &&
    filterOperators.has(value.operator) &&
    (value.invalid === undefined || typeof value.invalid === 'boolean')
  );
}

function isRelationship(value: unknown): value is RelationshipDefinition {
  if (!isRecord(value) || !isFieldPath(value.parentField)) return false;
  if (value.kind === 'native') {
    return (
      typeof value.targetModelZuid === 'string' && /^6-[a-z0-9-]{5,}$/i.test(value.targetModelZuid)
    );
  }
  return value.kind === 'custom' && isFieldPath(value.childField);
}

function hasSafeReference(value: Readonly<Record<string, unknown>>): boolean {
  if (
    typeof value.managerBaseUrl !== 'string' ||
    typeof value.area !== 'string' ||
    typeof value.modelZuid !== 'string'
  ) {
    return false;
  }
  const parsed = parseCollectionReference(
    `${value.managerBaseUrl}/${value.area}/${value.modelZuid}`,
  );
  return (
    parsed.ok &&
    parsed.value.instanceZuid === value.instanceZuid &&
    parsed.value.modelZuid === value.modelZuid &&
    parsed.value.deployment === value.deployment &&
    parsed.value.area === value.area &&
    parsed.value.apiBaseUrl === value.apiBaseUrl &&
    parsed.value.managerBaseUrl === value.managerBaseUrl
  );
}

function isCollectionNode(value: unknown, depth = 1): value is CollectionNode {
  if (!isRecord(value) || depth > 5) return false;
  if (!/^node-[a-z0-9-]+$/i.test(String(value.id)) || typeof value.name !== 'string') return false;
  if (!isRecord(value.reference) || !isRecord(value.presentation)) return false;
  if (!Array.isArray(value.children)) return false;

  const reference = value.reference;
  const presentation = value.presentation;
  const referenceValid = hasSafeReference(reference);
  const presentationValid =
    isStringArray(presentation.visibleColumns) &&
    isRecord(presentation.columnWidths) &&
    Object.values(presentation.columnWidths).every(
      (width) =>
        typeof width === 'number' && Number.isFinite(width) && width >= 40 && width <= 2_000,
    ) &&
    isSortState(presentation.sort) &&
    Array.isArray(presentation.filters) &&
    presentation.filters.every(isViewFilter) &&
    typeof presentation.freeText === 'string';

  return (
    referenceValid &&
    presentationValid &&
    (value.relationship === undefined || isRelationship(value.relationship)) &&
    value.children.every((child) => isCollectionNode(child, depth + 1))
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function declaredGzipSize(bytes: Uint8Array): number {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error('View payload is not gzip data.');
  }
  const offset = bytes.length - 4;
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function validateDecodedView(value: unknown): PersistedView | undefined {
  const decoded = Schema.decodeUnknownEither(VersionedViewSchema)(value);
  if (
    Either.isLeft(decoded) ||
    !isCollectionNode(decoded.right.root) ||
    !decoded.right.viewFilters.every(isViewFilter)
  ) {
    return undefined;
  }
  if (!validateCollectionTree(decoded.right.root).ok) return undefined;
  return {
    version: 1,
    root: decoded.right.root,
    contentState: decoded.right.contentState,
    viewFilters: decoded.right.viewFilters,
    globalFreeText: decoded.right.globalFreeText,
  };
}

export const ViewCodec = {
  encode(view: PersistedView): { readonly fragment: string; readonly length: number } {
    assertNonSecretState(view);
    const validated = validateDecodedView(view);
    if (!validated) throw new Error('Only valid, settled non-secret view state may be encoded.');
    const json = JSON.stringify(canonicalize(validated));
    const payload = bytesToBase64Url(gzipSync(strToU8(json), { level: 9, mtime: 0 }));
    const fragment = `#view=${payload}`;
    return { fragment, length: fragment.length };
  },

  decode(fragment: string): ViewDecodeResult {
    const raw = fragment.replace(/^#?view=/, '');
    try {
      if (raw.length > maximumEncodedLength) throw new Error('View payload is too large.');
      const compressed = base64UrlToBytes(raw);
      if (declaredGzipSize(compressed) > maximumDecodedLength) {
        throw new Error('Decoded view payload is too large.');
      }
      const bytes = gunzipSync(compressed);
      if (bytes.length > maximumDecodedLength)
        throw new Error('Decoded view payload is too large.');
      const json = strFromU8(bytes);
      const parsed: unknown = JSON.parse(json);
      const view = validateDecodedView(parsed);
      if (!view) throw new Error('Invalid view');
      return { ok: true, view };
    } catch {
      return { ok: false, raw, reason: 'The shared view is invalid or truncated.' };
    }
  },
} as const;
