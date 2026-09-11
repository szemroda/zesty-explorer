import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  decodeCollectionPage,
  generateRelationshipGraph,
  type CollectionSnapshot,
  type ContentItem,
} from '../domain';
import {
  buildRelationshipIndex,
  createExplorerGraph,
  facetValues,
  filterNodeItemIds,
  joinRelatedItems,
  pageItemIds,
  sortItemIds,
} from '../explorer-core';
import { performanceBaselines } from './baselines';

const seed = 2_026;
const operations = [
  'normalize',
  'custom-index',
  'native-index',
  'custom-join',
  'native-join',
  'descendant-filter',
  'free-text',
  'facets',
  'sort',
  'page',
  'row-expansion',
] as const;

type Operation = (typeof operations)[number];

function percentile(samples: readonly number[], percentage: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)] ?? 0;
}

function measure(
  run: () => unknown,
  repetitions: number,
): { readonly p50: number; readonly p95: number } {
  run();
  const samples = Array.from({ length: repetitions }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

function rawPage(snapshot: CollectionSnapshot) {
  return {
    data: snapshot.items.map((item) => ({
      ...item.fields,
      meta: {
        zuid: item.id,
        created: item.metadata.created,
        modified: item.metadata.modified,
        version: item.metadata.version,
      },
    })),
    _meta: { totalResults: snapshot.items.length, page: 1, limit: snapshot.items.length },
  };
}

function nativeParents(
  parents: CollectionSnapshot,
  children: CollectionSnapshot,
): CollectionSnapshot {
  const items: readonly ContentItem[] = parents.items.map((item, index) => ({
    ...item,
    fields: { ...item.fields, primaryChild: children.items[index]?.id },
  }));
  return { ...parents, items, itemsById: new Map(items.map((item) => [item.id, item])) };
}

describe.each(performanceBaselines)('ExplorerCore with $totalItems generated items', (baseline) => {
  it('reports every operation and enforces product and local-variance budgets', () => {
    const perCollection = baseline.totalItems / 2;
    const generated = generateRelationshipGraph(perCollection, seed);
    const raw = rawPage(generated.children);
    const customRelationship = {
      kind: 'custom' as const,
      parentField: ['childKey'],
      childField: ['parentKey'],
    };
    const nativeRelationship = {
      kind: 'native' as const,
      parentField: ['primaryChild'],
      targetModelZuid: generated.children.modelZuid,
    };
    const nativeParentSnapshot = nativeParents(generated.parents, generated.children);
    const customIndex = buildRelationshipIndex(generated.children, ['parentKey']);
    const customRelations = joinRelatedItems(generated.parents, customIndex, customRelationship);
    const graph = createExplorerGraph({
      rootNodeId: 'node-root',
      snapshots: new Map([
        ['node-root', generated.parents],
        ['node-child', generated.children],
      ]),
      childrenByNode: new Map([['node-root', ['node-child']]]),
      relationshipsByChildNode: new Map([['node-child', customRelations]]),
    });
    const rootIds = generated.parents.items.map((item) => item.id);
    const repetitions = baseline.totalItems < 50_000 ? 5 : 3;

    const runners: Readonly<Record<Operation, () => unknown>> = {
      normalize: () => decodeCollectionPage(raw),
      'custom-index': () => buildRelationshipIndex(generated.children, ['parentKey']),
      'native-index': () => buildRelationshipIndex(generated.children, ['id']),
      'custom-join': () => joinRelatedItems(generated.parents, customIndex, customRelationship),
      'native-join': () =>
        joinRelatedItems(
          nativeParentSnapshot,
          buildRelationshipIndex(generated.children, ['id']),
          nativeRelationship,
        ),
      'descendant-filter': () =>
        filterNodeItemIds(graph, 'node-root', rootIds, [
          {
            id: 'active-child',
            nodePath: ['node-child'],
            fieldPath: ['active'],
            operator: 'false',
          },
        ]),
      'free-text': () => filterNodeItemIds(graph, 'node-root', rootIds, [], 'not-present'),
      facets: () => facetValues(generated.children, ['parentKey']),
      sort: () =>
        sortItemIds(generated.parents, rootIds, { fieldPath: ['score'], direction: 'asc' }),
      page: () => pageItemIds(rootIds, Math.floor(rootIds.length / 100) - 1, 100),
      'row-expansion': () => graph.relatedItemIds('node-child', rootIds[0]!),
    };

    const report = Object.fromEntries(
      operations.map((operation) => [operation, measure(runners[operation], repetitions)]),
    ) as Readonly<Record<Operation, { readonly p50: number; readonly p95: number }>>;
    console.info(
      `PERF ${baseline.totalItems} items seed=${seed}`,
      Object.fromEntries(
        operations.map((operation) => [operation, Number(report[operation].p95.toFixed(2))]),
      ),
    );

    expect(Either.isRight(decodeCollectionPage(raw))).toBe(true);
    for (const operation of operations) {
      const stored = baseline.p95Ms[operation] ?? baseline.p95Ms.all;
      expect(stored, `missing baseline for ${operation}`).toBeDefined();
      expect(report[operation].p95, `${operation} exceeded twice its local baseline`).toBeLessThan(
        stored! * 2,
      );
    }
    const expensive = Math.max(...operations.map((operation) => report[operation].p95));
    if (baseline.totalItems === 10_000) expect(expensive).toBeLessThan(250);
    if (baseline.totalItems === 50_000) expect(expensive).toBeLessThan(1_000);
    expect(report['row-expansion'].p95).toBeLessThan(100);
  }, 60_000);
});
