import { Either, Schema } from 'effect';
import type { CollectionPage, ContentItem, ExplorerError, ItemZuid } from './types';

const ItemMetadataSchema = Schema.Struct({
  zuid: Schema.String,
  created: Schema.String,
  modified: Schema.String,
  version: Schema.Number,
});

const RawItemSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown }).pipe(
  Schema.filter((item) => 'meta' in item, { message: () => 'Content item metadata is missing' }),
);

const CollectionPageSchema = Schema.Struct({
  data: Schema.Array(RawItemSchema),
  _meta: Schema.Struct({
    totalResults: Schema.Number,
    page: Schema.Number,
    limit: Schema.Number,
  }),
});

const metadataKeys = new Set(['zuid', 'created', 'modified', 'version']);

function normalizeItem(raw: Readonly<Record<string, unknown>>): ContentItem {
  const decodedMetadata = Schema.decodeUnknownSync(ItemMetadataSchema)(raw.meta);
  const fields: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(raw)) {
    if (name !== 'meta') fields[name] = value;
  }

  const metadata = Object.fromEntries(
    Object.entries(decodedMetadata).filter(([name]) => name !== 'zuid' && metadataKeys.has(name)),
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
      page: page._meta.page,
      limit: page._meta.limit,
    })),
    Either.mapLeft((): ExplorerError => ({
      kind: 'decoding',
      message: 'Zesty returned collection data in an unsupported shape.',
    })),
  );
}
