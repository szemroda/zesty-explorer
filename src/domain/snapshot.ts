import { Either, Schema } from 'effect';
import type { CollectionPage, ContentItem, ExplorerError, ItemZuid } from './types';

const ItemZuidSchema = Schema.String.pipe(
  Schema.filter((value) => /^7-[a-z0-9][a-z0-9-]{4,}$/i.test(value), {
    message: () => 'Content item ZUID is invalid',
  }),
);

const ItemMetadataSchema = Schema.Struct({
  zuid: ItemZuidSchema,
  created: Schema.String,
  modified: Schema.String,
  version: Schema.Number,
});

const RawItemSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown }).pipe(
  Schema.filter(
    (item) =>
      'meta' in item && Either.isRight(Schema.decodeUnknownEither(ItemMetadataSchema)(item.meta)),
    { message: () => 'Content item metadata is missing or invalid' },
  ),
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

function normalizeItem(raw: Readonly<Record<string, unknown>>): ContentItem {
  const decodedMetadata = Schema.decodeUnknownSync(ItemMetadataSchema)(raw.meta);
  const fields: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(raw)) {
    if (name !== 'meta') fields[name] = value;
  }

  const rawMetadata =
    typeof raw.meta === 'object' && raw.meta !== null && !Array.isArray(raw.meta) ? raw.meta : {};
  const metadata = Object.fromEntries(
    Object.entries(rawMetadata).filter(([name]) => name !== 'zuid'),
  );

  return {
    id: decodedMetadata.zuid as ItemZuid,
    fields,
    metadata,
    raw,
  };
}

export function decodeCollectionPage(input: unknown): Either.Either<CollectionPage, ExplorerError> {
  return Schema.decodeUnknownEither(CollectionPageSchema)(input).pipe(
    Either.map((page) => ({
      items: page.data.map(normalizeItem),
      totalResults: page._meta.totalResults,
      page:
        page._meta.page ??
        Math.floor((page._meta.start ?? page._meta.offset ?? 0) / page._meta.limit) + 1,
      limit: page._meta.limit,
    })),
    Either.mapLeft((): ExplorerError => ({
      kind: 'decoding',
      message: 'Zesty returned collection data in an unsupported shape.',
    })),
  );
}
