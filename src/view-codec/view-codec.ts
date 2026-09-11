import { Either, Schema } from 'effect';
import { compressSync, decompressSync, strFromU8, strToU8 } from 'fflate';
import type { PersistedView } from '../domain';

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

function isCollectionNode(value: unknown, depth = 1): boolean {
  if (!isRecord(value) || depth > 5) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (!isRecord(value.reference) || !isRecord(value.presentation)) return false;
  if (!Array.isArray(value.children)) return false;

  const reference = value.reference;
  const presentation = value.presentation;
  const referenceValid =
    typeof reference.instanceZuid === 'string' &&
    typeof reference.modelZuid === 'string' &&
    ['production', 'stage', 'development'].includes(String(reference.deployment)) &&
    ['content', 'blocks'].includes(String(reference.area)) &&
    typeof reference.apiBaseUrl === 'string' &&
    typeof reference.managerBaseUrl === 'string';
  const presentationValid =
    isStringArray(presentation.visibleColumns) &&
    isRecord(presentation.columnWidths) &&
    isRecord(presentation.sort) &&
    Array.isArray(presentation.filters) &&
    typeof presentation.freeText === 'string';

  return (
    referenceValid &&
    presentationValid &&
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

function validateDecodedView(value: unknown): PersistedView | undefined {
  const decoded = Schema.decodeUnknownEither(VersionedViewSchema)(value);
  if (Either.isLeft(decoded) || !isCollectionNode(decoded.right.root)) return undefined;
  return decoded.right as PersistedView;
}

export const ViewCodec = {
  encode(view: PersistedView): { readonly fragment: string; readonly length: number } {
    assertNonSecretState(view);
    const validated = validateDecodedView(view);
    if (!validated) throw new Error('Only valid, settled non-secret view state may be encoded.');
    const json = JSON.stringify(canonicalize(validated));
    const payload = bytesToBase64Url(compressSync(strToU8(json), { level: 9 }));
    const fragment = `#view=${payload}`;
    return { fragment, length: fragment.length };
  },

  decode(fragment: string): ViewDecodeResult {
    const raw = fragment.replace(/^#?view=/, '');
    try {
      const json = strFromU8(decompressSync(base64UrlToBytes(raw)));
      const parsed: unknown = JSON.parse(json);
      const view = validateDecodedView(parsed);
      if (!view) throw new Error('Invalid view');
      return { ok: true, view };
    } catch {
      return { ok: false, raw, reason: 'The shared view is invalid or truncated.' };
    }
  },
} as const;
