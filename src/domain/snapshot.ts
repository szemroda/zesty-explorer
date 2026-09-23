import { Either, Schema } from 'effect';
import type {
  CollectionPage,
  ContentItem,
  ContentItemVersion,
  ExplorerError,
  ItemZuid,
} from './types';
import { UserZuidSchema } from './zuid-schema';
import { unsupportedShapeError } from './error-diagnostic';

const ItemZuidSchema = Schema.String.pipe(
  Schema.filter((value) => /^7-[a-z0-9][a-z0-9-]{4,}$/i.test(value), {
    message: () => 'Content item ZUID is invalid',
  }),
);

const ItemMetadataSchema = Schema.Struct({
  ZUID: ItemZuidSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  version: Schema.Number,
});

const RawItemSchema = Schema.asSchema(
  Schema.Struct({
    data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    meta: ItemMetadataSchema,
  }).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
);

const CollectionPageSchema = Schema.Struct({
  data: Schema.Array(RawItemSchema),
  _meta: Schema.Struct({
    totalResults: Schema.Number,
    page: Schema.optional(Schema.Number),
    start: Schema.optional(Schema.Number),
    offset: Schema.optional(Schema.Number),
    limit: Schema.Number,
  }),
});

const VersionWebSchema = Schema.Struct({
  versionZUID: Schema.optional(Schema.Unknown),
  createdAt: Schema.optional(Schema.String),
  createdByUserZUID: Schema.optional(Schema.NullOr(UserZuidSchema)),
});

const RawVersionItemSchema = Schema.asSchema(
  Schema.Struct({
    data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    meta: ItemMetadataSchema,
    web: Schema.optional(VersionWebSchema),
  }).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
);

const ItemVersionsResponseSchema = Schema.Struct({ data: Schema.Array(RawVersionItemSchema) });

function normalizeItem(raw: typeof RawItemSchema.Type): ContentItem {
  const decodedMetadata = Schema.decodeUnknownSync(ItemMetadataSchema)(raw.meta);
  const rawMetadata =
    typeof raw.meta === 'object' && raw.meta !== null && !Array.isArray(raw.meta) ? raw.meta : {};
  const metadata: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(rawMetadata)) {
    if (name === 'ZUID') continue;
    if (name === 'createdAt') metadata.created = value;
    else if (name === 'updatedAt') metadata.modified = value;
    else metadata[name] = value;
  }

  return {
    id: decodedMetadata.ZUID as ItemZuid,
    fields: raw.data,
    metadata,
    raw,
  };
}

export function decodeCollectionPage(input: unknown): Either.Either<CollectionPage, ExplorerError> {
  return Schema.decodeUnknownEither(CollectionPageSchema, {
    errors: 'all',
    onExcessProperty: 'preserve',
  })(input).pipe(
    Either.map((page) => ({
      items: page.data.map(normalizeItem),
      totalResults: page._meta.totalResults,
      page:
        page._meta.page ??
        Math.floor((page._meta.start ?? page._meta.offset ?? 0) / page._meta.limit) + 1,
      limit: page._meta.limit,
    })),
    Either.mapLeft((error) =>
      unsupportedShapeError('Zesty returned collection data in an unsupported shape.', error),
    ),
  );
}

export function decodeItemVersions(
  input: unknown,
): Either.Either<readonly ContentItemVersion[], ExplorerError> {
  return Schema.decodeUnknownEither(ItemVersionsResponseSchema, {
    errors: 'all',
    onExcessProperty: 'preserve',
  })(input).pipe(
    Either.map(({ data }) =>
      data.map((raw) => ({
        number: raw.meta.version,
        ...(raw.web?.createdAt ? { savedAt: raw.web.createdAt } : {}),
        ...(raw.web?.createdByUserZUID ? { authorZuid: raw.web.createdByUserZUID } : {}),
        item: normalizeItem(raw),
      })),
    ),
    Either.mapLeft((error) =>
      unsupportedShapeError('Zesty returned item versions in an unsupported shape.', error),
    ),
  );
}
