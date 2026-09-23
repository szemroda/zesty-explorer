import { Either, Effect, Schema } from 'effect';
import {
  decodeCollectionPage,
  decodeItemVersions,
  safeRequestUrl,
  unsupportedShapeError,
  UserZuidSchema,
  type CollectionCatalog,
  type CollectionCatalogEntry,
  type CollectionCatalogGroup,
  type CollectionField,
  type CollectionReference,
  type CollectionSchema,
  type CollectionSnapshot,
  type ContentItem,
  type ExplorerError,
  type ExplorerDecodingIssue,
  type ExplorerErrorDiagnostic,
  type ExplorerRequestOperation,
  type FieldKind,
  type FieldZuid,
  type InstanceReference,
  type InstanceUser,
  type ItemPublishing,
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
const RawCatalogResponseSchema = Schema.Struct({ data: Schema.Array(Schema.Unknown) });
const RawModelSchema = Schema.Struct({
  ZUID: ModelZuidSchema,
  label: Schema.String,
  name: Schema.String,
  type: Schema.String,
});

const RawPublishingSchema = Schema.Struct({
  ZUID: Schema.String,
  version: Schema.Number,
  publishAt: Schema.optional(Schema.NullOr(Schema.String)),
  unpublishAt: Schema.optional(Schema.NullOr(Schema.String)),
  _active: Schema.Boolean,
});
const RawPublishingsResponseSchema = Schema.Struct({ data: Schema.Array(RawPublishingSchema) });
const RawInstanceUserSchema = Schema.Struct({
  ZUID: UserZuidSchema,
  firstName: Schema.optional(Schema.NullOr(Schema.String)),
  lastName: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
});
const RawInstanceUsersResponseSchema = Schema.Struct({ data: Schema.Array(RawInstanceUserSchema) });

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
  const decoded = Schema.decodeUnknownEither(RawFieldsResponseSchema, { errors: 'all' })(input);
  if (Either.isLeft(decoded)) {
    return Effect.fail(
      unsupportedShapeError('Zesty returned model fields in an unsupported shape.', decoded.left),
    );
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

const contentModelTypes = new Set(['content', 'dataset', 'item', 'pageset']);

function catalogGroup(type: string): CollectionCatalogGroup {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'block' || normalized === 'blocks') return 'blocks';
  if (contentModelTypes.has(normalized)) return 'content';
  return 'other';
}

function prefixCatalogIssues(
  error: ExplorerError,
  recordIndex: number,
): NonNullable<ExplorerError['diagnostic']>['issues'] {
  return error.diagnostic?.issues?.map((issue) => ({
    ...issue,
    path:
      issue.path === '$'
        ? `$.data[${recordIndex}]`
        : `$.data[${recordIndex}]${issue.path.slice(1)}`,
  }));
}

function decodeCatalog(
  reference: InstanceReference,
  input: unknown,
): Effect.Effect<CollectionCatalog, ExplorerError> {
  const envelope = Schema.decodeUnknownEither(RawCatalogResponseSchema, { errors: 'all' })(input);
  if (Either.isLeft(envelope)) {
    return Effect.fail(
      unsupportedShapeError(
        'Zesty returned the collection catalog in an unsupported shape.',
        envelope.left,
      ),
    );
  }

  const collections: CollectionCatalogEntry[] = [];
  const issues: ExplorerDecodingIssue[] = [];
  let issuesOmitted = false;
  envelope.right.data.forEach((record, index) => {
    const decoded = Schema.decodeUnknownEither(RawModelSchema, { errors: 'all' })(record);
    if (Either.isLeft(decoded)) {
      const recordError = unsupportedShapeError('A collection record is invalid.', decoded.left);
      const recordIssues = prefixCatalogIssues(recordError, index) ?? [];
      const available = Math.max(0, 20 - issues.length);
      issues.push(...recordIssues.slice(0, available));
      if (recordIssues.length > available || recordError.diagnostic?.issuesOmitted)
        issuesOmitted = true;
      return;
    }

    const group = catalogGroup(decoded.right.type);
    collections.push({
      label: decoded.right.label,
      name: decoded.right.name,
      type: decoded.right.type,
      group,
      reference: {
        instanceZuid: reference.instanceZuid,
        modelZuid: decoded.right.ZUID as ModelZuid,
        deployment: reference.deployment,
        area: group,
        apiBaseUrl: reference.apiBaseUrl,
        managerBaseUrl: reference.managerBaseUrl,
      },
    });
  });

  return Effect.succeed({
    collections,
    incomplete: issues.length > 0 || issuesOmitted,
    ...(issues.length > 0 || issuesOmitted
      ? {
          warning: {
            kind: 'decoding' as const,
            message: 'Some collection records could not be understood and were omitted.',
            diagnostic: {
              ...(issues.length > 0 ? { issues } : {}),
              ...(issuesOmitted ? { issuesOmitted: true } : {}),
            },
          },
        }
      : {}),
  });
}

function decodePublishings(
  input: unknown,
): Effect.Effect<readonly ItemPublishing[], ExplorerError> {
  const decoded = Schema.decodeUnknownEither(RawPublishingsResponseSchema, { errors: 'all' })(
    input,
  );
  if (Either.isLeft(decoded)) {
    return Effect.fail(
      unsupportedShapeError(
        'Zesty returned item publishings in an unsupported shape.',
        decoded.left,
      ),
    );
  }

  return Effect.succeed(
    decoded.right.data.map((publishing) => ({
      version: publishing.version,
      ...(publishing.publishAt ? { publishAt: publishing.publishAt } : {}),
      ...(publishing.unpublishAt ? { unpublishAt: publishing.unpublishAt } : {}),
      active: publishing._active,
    })),
  );
}

function decodeInstanceUsers(
  input: unknown,
): Effect.Effect<readonly InstanceUser[], ExplorerError> {
  const decoded = Schema.decodeUnknownEither(RawInstanceUsersResponseSchema, { errors: 'all' })(
    input,
  );
  if (Either.isLeft(decoded)) {
    return Effect.fail(
      unsupportedShapeError('Zesty returned instance users in an unsupported shape.', decoded.left),
    );
  }

  return Effect.succeed(
    decoded.right.data.map((user) => ({
      id: user.ZUID,
      ...(user.firstName ? { firstName: user.firstName } : {}),
      ...(user.lastName ? { lastName: user.lastName } : {}),
      ...(user.email ? { email: user.email } : {}),
    })),
  );
}

const accountsApiBaseUrls = {
  production: 'https://accounts.api.zesty.io/v1',
  stage: 'https://accounts.api.stage.zesty.io/v1',
  development: 'https://accounts.api.dev.zesty.io/v1',
} as const;

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

function withRequestDiagnostic(
  error: ExplorerError,
  operation: ExplorerRequestOperation,
  requestUrl: string,
  responseStatus?: number,
): ExplorerError {
  const diagnostic: ExplorerErrorDiagnostic = {
    ...error.diagnostic,
    operation,
    requestUrl: safeRequestUrl(requestUrl),
    ...(responseStatus === undefined ? {} : { responseStatus }),
  };
  return { ...error, diagnostic };
}

function createRequester(
  transport: ZestyTransport,
  timeoutMs: number,
  retryDelaysMs: readonly number[],
) {
  const requestAttempt = (
    request: ZestyTransportRequest,
    operation: ExplorerRequestOperation,
  ): Effect.Effect<ZestyTransportResponse, ExplorerError> =>
    transport.request(request).pipe(
      Effect.mapError((): ExplorerError =>
        withRequestDiagnostic(
          { kind: 'network', message: 'The Zesty request could not reach the server.' },
          operation,
          request.url,
        ),
      ),
      Effect.flatMap((response) => {
        const error = statusError(response);
        return error
          ? Effect.fail(withRequestDiagnostic(error, operation, request.url, response.status))
          : Effect.succeed(response);
      }),
      Effect.timeoutFail({
        duration: timeoutMs,
        onTimeout: (): ExplorerError =>
          withRequestDiagnostic(
            { kind: 'timeout', message: 'The Zesty request timed out.' },
            operation,
            request.url,
          ),
      }),
    );

  const requestWithRetry = (
    request: ZestyTransportRequest,
    operation: ExplorerRequestOperation,
    retryIndex = 0,
  ): Effect.Effect<ZestyTransportResponse, ExplorerError> =>
    requestAttempt(request, operation).pipe(
      Effect.catchAll((error) => {
        const delay = retryDelaysMs[retryIndex];
        if (!retryable(error) || delay === undefined) return Effect.fail(error);
        return Effect.sleep(delay).pipe(
          Effect.flatMap(() => requestWithRetry(request, operation, retryIndex + 1)),
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
    loadCollectionCatalog: (reference, sessionToken) => {
      const requestUrl = `${reference.apiBaseUrl}/content/models`;
      const operation = 'load-collection-catalog' as const;
      return request(authenticatedRequest(requestUrl, sessionToken), operation).pipe(
        Effect.flatMap((response) =>
          decodeCatalog(reference, response.body).pipe(
            Effect.map((catalog) =>
              catalog.warning
                ? {
                    ...catalog,
                    warning: withRequestDiagnostic(
                      catalog.warning,
                      operation,
                      requestUrl,
                      response.status,
                    ),
                  }
                : catalog,
            ),
            Effect.mapError((error) =>
              withRequestDiagnostic(error, operation, requestUrl, response.status),
            ),
          ),
        ),
      );
    },

    loadCollectionSchema: (reference, sessionToken) => {
      const url = new URL(`${reference.apiBaseUrl}/content/models/${reference.modelZuid}/fields`);
      url.searchParams.set('lang', 'en-US');
      const requestUrl = url.toString();
      const operation = 'load-collection-schema' as const;
      return request(authenticatedRequest(requestUrl, sessionToken), operation).pipe(
        Effect.flatMap((response) =>
          decodeSchema(reference, response.body).pipe(
            Effect.mapError((error) =>
              withRequestDiagnostic(error, operation, requestUrl, response.status),
            ),
          ),
        ),
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

          const requestUrl = url.toString();
          const operation = 'load-collection-items' as const;
          const response = yield* request(
            authenticatedRequest(requestUrl, sessionToken),
            operation,
          );
          const decoded = decodeCollectionPage(response.body);
          if (Either.isLeft(decoded)) {
            return yield* Effect.fail(
              withRequestDiagnostic(decoded.left, operation, requestUrl, response.status),
            );
          }

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

    loadItemVersions: (reference, sessionToken) => {
      const requestUrl = `${reference.apiBaseUrl}/content/models/${reference.modelZuid}/items/${reference.itemZuid}/versions`;
      const operation = 'load-item-versions' as const;
      return request(authenticatedRequest(requestUrl, sessionToken), operation).pipe(
        Effect.flatMap((response) => {
          const decoded = decodeItemVersions(response.body);
          return Either.isLeft(decoded)
            ? Effect.fail(
                withRequestDiagnostic(decoded.left, operation, requestUrl, response.status),
              )
            : Effect.succeed(decoded.right);
        }),
      );
    },

    loadItemPublishings: (reference, sessionToken) => {
      const requestUrl = `${reference.apiBaseUrl}/content/models/${reference.modelZuid}/items/${reference.itemZuid}/publishings`;
      const operation = 'load-item-publishings' as const;
      return request(authenticatedRequest(requestUrl, sessionToken), operation).pipe(
        Effect.flatMap((response) =>
          decodePublishings(response.body).pipe(
            Effect.mapError((error) =>
              withRequestDiagnostic(error, operation, requestUrl, response.status),
            ),
          ),
        ),
      );
    },

    loadInstanceUsers: (reference, sessionToken) => {
      const requestUrl = `${accountsApiBaseUrls[reference.deployment]}/instances/${reference.instanceZuid}/users`;
      const operation = 'load-instance-users' as const;
      return request(authenticatedRequest(requestUrl, sessionToken), operation).pipe(
        Effect.flatMap((response) =>
          decodeInstanceUsers(response.body).pipe(
            Effect.mapError((error) =>
              withRequestDiagnostic(error, operation, requestUrl, response.status),
            ),
          ),
        ),
      );
    },
  };
}
