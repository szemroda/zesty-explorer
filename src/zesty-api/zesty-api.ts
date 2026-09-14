import { Either, Effect, Schema } from 'effect';
import {
  decodeCollectionPage,
  type CollectionField,
  type CollectionReference,
  type CollectionSchema,
  type CollectionSnapshot,
  type ContentItem,
  type ExplorerError,
  type FieldKind,
  type FieldZuid,
  type ModelZuid,
} from '../domain';
import type {
  ZestyApi,
  ZestyApiOptions,
  ZestyTransport,
  ZestyTransportRequest,
  ZestyTransportResponse,
} from './types';

const FieldZuidSchema = Schema.String.pipe(
  Schema.filter((value) => /^12-[a-z0-9][a-z0-9-]{4,}$/i.test(value), {
    message: () => 'Field ZUID is invalid',
  }),
);
const ModelZuidSchema = Schema.String.pipe(
  Schema.filter((value) => /^6-[a-z0-9][a-z0-9-]{4,}$/i.test(value), {
    message: () => 'Related model ZUID is invalid',
  }),
);

const ScalarSchema = Schema.Union(Schema.String, Schema.Number, Schema.Boolean);
const RawOptionsSchema = Schema.NullOr(
  Schema.Union(
    Schema.Array(ScalarSchema),
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
);

const RawFieldSchema = Schema.Struct({
  ZUID: FieldZuidSchema,
  name: Schema.String,
  label: Schema.String,
  datatype: Schema.String,
  relatedModelZUID: Schema.optional(Schema.NullOr(ModelZuidSchema)),
  options: Schema.optional(RawOptionsSchema),
  settings: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        options: Schema.optional(RawOptionsSchema),
      }),
    ),
  ),
});

const RawFieldsResponseSchema = Schema.Struct({ data: Schema.Array(RawFieldSchema) });

const defaultOptions = {
  pageSize: 2_500,
  collectionLimit: 10_000,
  timeoutMs: 15_000,
  retryDelaysMs: [150, 500, 1_500] as readonly number[],
};

function fieldKind(datatype: string): FieldKind {
  const normalized = datatype.toLowerCase().replaceAll('_', '-');
  if (
    normalized.includes('relationship') ||
    normalized === 'one-to-one' ||
    normalized === 'one-to-many'
  ) {
    return 'relationship';
  }
  if (normalized.includes('bool') || normalized === 'yes-no') return 'boolean';
  if (normalized.includes('date') || normalized.includes('time')) return 'date';
  if (
    normalized.includes('number') ||
    normalized.includes('integer') ||
    normalized.includes('float')
  ) {
    return 'number';
  }
  if (
    normalized.includes('json') ||
    normalized.includes('object') ||
    normalized.includes('array')
  ) {
    return 'structured';
  }
  return 'text';
}

function fieldOptions(
  field: typeof RawFieldSchema.Type,
): readonly (string | number | boolean)[] | undefined {
  const options = field.options ?? field.settings?.options;
  if (Array.isArray(options)) {
    const scalarOptions: (string | number | boolean)[] = [];
    for (const option of options) {
      if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
        scalarOptions.push(option);
      }
    }
    return scalarOptions;
  }
  if (options && typeof options === 'object') return Object.keys(options);
  return undefined;
}

function decodeSchema(
  reference: CollectionReference,
  input: unknown,
): Effect.Effect<CollectionSchema, ExplorerError> {
  const decoded = Schema.decodeUnknownEither(RawFieldsResponseSchema)(input);
  if (Either.isLeft(decoded)) {
    return Effect.fail({
      kind: 'decoding',
      message: 'Zesty returned model fields in an unsupported shape.',
    });
  }

  const fields: CollectionField[] = decoded.right.data.map((field) => {
    const options = fieldOptions(field);
    return {
      id: field.ZUID as FieldZuid,
      name: field.name,
      label: field.label,
      kind: fieldKind(field.datatype),
      ...(field.relatedModelZUID ? { relatedModelZuid: field.relatedModelZUID as ModelZuid } : {}),
      ...(options ? { options } : {}),
    };
  });
  return Effect.succeed({ modelZuid: reference.modelZuid, label: reference.modelZuid, fields });
}

function statusError(response: ZestyTransportResponse): ExplorerError | undefined {
  if (response.status >= 200 && response.status < 300) return undefined;
  if (response.status === 401) {
    return {
      kind: 'authentication',
      status: 401,
      message: 'The Zesty session token is invalid or expired.',
    };
  }
  if (response.status === 403) {
    return {
      kind: 'permission',
      status: 403,
      message: 'Your Zesty session cannot read this collection.',
    };
  }
  if (response.status === 404) {
    return { kind: 'missing-resource', status: 404, message: 'The collection was not found.' };
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers['retry-after']);
    return {
      kind: 'rate-limit',
      message: 'Zesty is rate limiting requests. Try again shortly.',
      ...(Number.isFinite(retryAfter) ? { retryAfterMs: retryAfter * 1_000 } : {}),
    };
  }
  if (response.status >= 500) {
    return {
      kind: 'server',
      status: response.status,
      message: 'Zesty could not complete the request.',
    };
  }
  return { kind: 'network', message: `Zesty returned HTTP ${response.status}.` };
}

function retryable(error: ExplorerError): boolean {
  return error.kind === 'network' || error.kind === 'rate-limit' || error.kind === 'server';
}

function createRequester(
  transport: ZestyTransport,
  timeoutMs: number,
  retryDelaysMs: readonly number[],
) {
  const requestAttempt = (
    request: ZestyTransportRequest,
  ): Effect.Effect<ZestyTransportResponse, ExplorerError> =>
    transport.request(request).pipe(
      Effect.mapError((): ExplorerError => ({
        kind: 'network',
        message: 'The Zesty request could not reach the server.',
      })),
      Effect.flatMap((response) => {
        const error = statusError(response);
        return error ? Effect.fail(error) : Effect.succeed(response);
      }),
      Effect.timeoutFail({
        duration: timeoutMs,
        onTimeout: (): ExplorerError => ({
          kind: 'timeout',
          message: 'The Zesty request timed out.',
        }),
      }),
    );

  const requestWithRetry = (
    request: ZestyTransportRequest,
    retryIndex = 0,
  ): Effect.Effect<ZestyTransportResponse, ExplorerError> =>
    requestAttempt(request).pipe(
      Effect.catchAll((error) => {
        const delay = retryDelaysMs[retryIndex];
        if (!retryable(error) || delay === undefined) return Effect.fail(error);
        return Effect.sleep(delay).pipe(
          Effect.flatMap(() => requestWithRetry(request, retryIndex + 1)),
        );
      }),
    );

  return requestWithRetry;
}

function authenticatedRequest(url: string, sessionToken: string): ZestyTransportRequest {
  return {
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
  };
}

export function createZestyApi(transport: ZestyTransport, options: ZestyApiOptions = {}): ZestyApi {
  const resolved = { ...defaultOptions, ...options };
  const request = createRequester(transport, resolved.timeoutMs, resolved.retryDelaysMs);

  return {
    loadCollectionSchema: (reference, sessionToken) => {
      const url = new URL(`${reference.apiBaseUrl}/content/models/${reference.modelZuid}/fields`);
      url.searchParams.set('lang', 'en-US');
      return request(authenticatedRequest(url.toString(), sessionToken)).pipe(
        Effect.flatMap((response) => decodeSchema(reference, response.body)),
      );
    },

    loadCollectionSnapshot: (reference, state, sessionToken, itemLimit) =>
      Effect.gen(function* () {
        const items: ContentItem[] = [];
        let page = 1;
        let totalResults = Number.POSITIVE_INFINITY;
        const effectiveLimit = Math.min(
          resolved.collectionLimit,
          Math.max(0, itemLimit ?? resolved.collectionLimit),
        );

        while (items.length < totalResults && items.length < effectiveLimit) {
          const url = new URL(
            `${reference.apiBaseUrl}/content/models/${reference.modelZuid}/items`,
          );
          url.searchParams.set('lang', 'en-US');
          url.searchParams.set(
            'limit',
            String(Math.min(resolved.pageSize, effectiveLimit - items.length)),
          );
          url.searchParams.set('page', String(page));
          if (state === 'published') url.searchParams.set('_active', 'true');

          const response = yield* request(authenticatedRequest(url.toString(), sessionToken));
          const decoded = decodeCollectionPage(response.body);
          if (Either.isLeft(decoded)) return yield* Effect.fail(decoded.left);

          totalResults = decoded.right.totalResults;
          const remaining = effectiveLimit - items.length;
          items.push(...decoded.right.items.slice(0, remaining));
          if (decoded.right.items.length === 0) break;
          page += 1;
        }

        return {
          id: `snapshot-${reference.instanceZuid}-${reference.modelZuid}-${state}-en-US`,
          instanceZuid: reference.instanceZuid,
          modelZuid: reference.modelZuid,
          state,
          language: 'en-US',
          items,
          itemsById: new Map(items.map((item) => [item.id, item])),
          partial: items.length < totalResults,
        } satisfies CollectionSnapshot;
      }),
  };
}
