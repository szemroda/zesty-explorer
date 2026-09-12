import type {
  CollectionField,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  FieldPath,
  ItemZuid,
  ModelZuid,
  RelationshipDefinition,
  Scalar,
} from '../domain';

export type RelationshipIndex = ReadonlyMap<Scalar, readonly ItemZuid[]>;

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function itemPathValue(item: ContentItem, path: FieldPath): unknown {
  const [head, ...tail] = path;
  if (!head) return undefined;
  let value: unknown;
  if (head === 'id') value = item.id;
  else if (head === 'metadata') value = item.metadata;
  else value = item.fields[head];

  for (const segment of tail) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  return value;
}

export function buildRelationshipIndex(
  children: CollectionSnapshot,
  childField: FieldPath,
): RelationshipIndex {
  const mutable = new Map<Scalar, ItemZuid[]>();
  for (const item of children.items) {
    const value = itemPathValue(item, childField);
    if (!isScalar(value)) continue;
    const matches = mutable.get(value);
    if (matches) matches.push(item.id);
    else mutable.set(value, [item.id]);
  }
  return mutable;
}

function nativeReferences(value: unknown): readonly Scalar[] {
  if (Array.isArray(value)) return value.flatMap(nativeReferences);
  if (isScalar(value)) return [value];
  if (typeof value === 'object' && value !== null && 'zuid' in value) {
    const zuid = (value as { readonly zuid?: unknown }).zuid;
    return isScalar(zuid) ? [zuid] : [];
  }
  return [];
}

export function joinRelatedItems(
  parents: CollectionSnapshot,
  childIndex: RelationshipIndex,
  relationship: RelationshipDefinition,
): ReadonlyMap<ItemZuid, readonly ItemZuid[]> {
  const result = new Map<ItemZuid, readonly ItemZuid[]>();
  for (const parent of parents.items) {
    const value = itemPathValue(parent, relationship.parentField);
    const keys =
      relationship.kind === 'native' ? nativeReferences(value) : isScalar(value) ? [value] : [];
    const matches: ItemZuid[] = [];
    for (const key of keys) matches.push(...(childIndex.get(key) ?? []));
    result.set(parent.id, matches);
  }
  return result;
}

export function findNativeRelationships(
  parentSchema: CollectionSchema,
  childModelZuid: ModelZuid,
): readonly CollectionField[] {
  return parentSchema.fields.filter(
    (field) => field.kind === 'relationship' && field.relatedModelZuid === childModelZuid,
  );
}

export function validateRelationshipPaths(
  relationship: RelationshipDefinition,
  parentPaths: readonly string[],
  childPaths: readonly string[],
): { readonly valid: boolean; readonly invalidPaths: readonly string[] } {
  const invalidPaths: string[] = [];
  const parent = relationship.parentField.join('.');
  if (!parentPaths.includes(parent)) invalidPaths.push(`parent.${parent}`);
  if (relationship.kind === 'custom') {
    const child = relationship.childField.join('.');
    if (!childPaths.includes(child)) invalidPaths.push(`child.${child}`);
  }
  return { valid: invalidPaths.length === 0, invalidPaths };
}

export function scalarFieldPaths(
  schema: CollectionSchema,
  snapshot?: CollectionSnapshot,
): readonly string[] {
  const paths = new Set<string>(['id', 'created', 'modified', 'version']);
  for (const field of schema.fields) {
    if (field.kind !== 'structured') paths.add(field.name);
  }

  const visit = (value: unknown, path: readonly string[], depth: number) => {
    if (depth > 5 || value === null || value === undefined || Array.isArray(value)) return;
    if (isScalar(value)) {
      paths.add(path.join('.'));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key], depth + 1);
  };
  for (const item of snapshot?.items ?? []) {
    for (const [name, value] of Object.entries(item.fields)) visit(value, [name], 1);
  }
  return [...paths].sort();
}
