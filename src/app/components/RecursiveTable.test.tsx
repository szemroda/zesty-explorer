import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Effect } from 'effect';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  generateRelationshipGraph,
  safeRequestUrl,
  type CollectionNode,
  type CollectionSchema,
  type ExplorerError,
  type ViewFilter,
} from '../../domain';
import { collectionNode } from '../../test/fixtures';
import { snapshotQueryKey } from '../../zesty-api';
import type { ItemVersionApi } from '../../zesty-api';
import type { LoadedView } from '../load-view';
import { PublicationStatusProvider } from './PublicationStatusCell';
import { RootTable } from './RootTable';

const generated = generateRelationshipGraph(5);
const rootSchema: CollectionSchema = {
  modelZuid: '6-fixture-parents',
  label: 'Parents',
  fields: [
    { id: '12-title000', name: 'title', label: 'Title', kind: 'text' },
    { id: '12-child000', name: 'childKey', label: 'Child key', kind: 'text' },
  ],
};
const childSchema: CollectionSchema = {
  modelZuid: '6-fixture-children',
  label: 'Children',
  fields: [
    { id: '12-title111', name: 'title', label: 'Title', kind: 'text' },
    { id: '12-parent11', name: 'parentKey', label: 'Parent key', kind: 'text' },
  ],
};
const child: CollectionNode = {
  ...collectionNode('node-child', '6-fixture-children'),
  name: 'Children',
  relationship: { kind: 'custom', parentField: ['childKey'], childField: ['parentKey'] },
};
const root: CollectionNode = {
  ...collectionNode('node-root', '6-fixture-parents', [child]),
  name: 'Parents',
};
const loadedView: LoadedView = {
  snapshots: {
    snapshots: new Map([
      [
        snapshotQueryKey(root.reference, 'latest'),
        { status: 'complete', snapshot: generated.parents },
      ],
      [
        snapshotQueryKey(child.reference, 'latest'),
        { status: 'complete', snapshot: generated.children },
      ],
    ]),
    totalItems: 10,
  },
  schemas: new Map([
    [root.id, rootSchema],
    [child.id, childSchema],
  ]),
  schemaErrors: new Map(),
};

// A root table over the Parents → Children fixture; props override the defaults.
function rootTable(props: Partial<ComponentProps<typeof RootTable>> = {}) {
  return (
    <RootTable
      schema={rootSchema}
      snapshot={generated.parents}
      reference={root.reference}
      treeRoot={root}
      loadedView={loadedView}
      contentState="latest"
      onOpenDetails={vi.fn()}
      onRetry={vi.fn()}
      onPresentationChange={vi.fn()}
      {...props}
    />
  );
}

function expandFirstParent() {
  fireEvent.click(
    screen.getByRole('button', {
      name: `Expand relationships for ${generated.parents.items[0]!.id}`,
    }),
  );
}

// The resize handle is a mouse-only affordance hidden from assistive technology.
function resizeHandle(table: HTMLElement, column: string): HTMLElement {
  const handle = within(table)
    .getByRole('columnheader', { name: column })
    .querySelector<HTMLElement>('[data-slot="column-resize-handle"]');
  if (!handle) throw new Error(`No resize handle for ${column}`);
  return handle;
}

// Drags a resize handle far past the minimum width. jsdom has no layout, so every drag starts
// from a zero width and only the clamp to the minimum is observable here.
function dragBelowMinimumWidth(handle: HTMLElement) {
  fireEvent.mouseDown(handle, { clientX: 300 });
  fireEvent.mouseMove(document, { clientX: -1000 });
  fireEvent.mouseUp(document);
}

describe('recursive collection tables', () => {
  it('shows Status in older explicit column selections and preserves a later hide', async () => {
    const onPresentationChange = vi.fn();
    const explicitRoot = {
      ...root,
      children: [],
      presentation: { ...root.presentation, visibleColumns: ['title'] },
    };
    const first = render(rootTable({ treeRoot: explicitRoot, onPresentationChange }));

    const collection = screen.getByRole('region', { name: 'Parents collection' });
    expect(within(collection).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    fireEvent.click(within(collection).getByRole('button', { name: 'Choose visible columns' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Status' }));
    expect(onPresentationChange).toHaveBeenLastCalledWith(
      explicitRoot.id,
      expect.objectContaining({ statusColumnHidden: true }),
    );

    first.unmount();
    render(
      rootTable({
        treeRoot: {
          ...explicitRoot,
          presentation: { ...explicitRoot.presentation, statusColumnHidden: true },
        },
      }),
    );
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('shows publication status in root and expanded nested tables', async () => {
    const loadVersions = vi.fn((reference: Parameters<ItemVersionApi['loadItemVersions']>[0]) => {
      const source =
        reference.modelZuid === rootSchema.modelZuid ? generated.parents : generated.children;
      const item = source.itemsById.get(reference.itemZuid)!;
      return Effect.succeed([{ number: Number(item.metadata.version), item }]);
    });
    const api: ItemVersionApi = {
      loadItemVersions: loadVersions,
      loadItemPublishings: () => Effect.succeed([]),
      loadInstanceUsers: () => Effect.succeed([]),
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PublicationStatusProvider api={api} sessionToken="token" credentialRevision="revision">
          {rootTable()}
        </PublicationStatusProvider>
      </QueryClientProvider>,
    );

    const rootTableRegion = screen.getByRole('region', { name: 'Parents collection' });
    expect(
      within(rootTableRegion).getByRole('columnheader', { name: 'Status' }),
    ).toBeInTheDocument();
    expect(
      await within(rootTableRegion).findByRole('img', { name: /Latest saved version/ }),
    ).toBeInTheDocument();
    expect(
      loadVersions.mock.calls.every(([reference]) => reference.modelZuid === rootSchema.modelZuid),
    ).toBe(true);

    expandFirstParent();
    const nested = await screen.findByRole('region', { name: 'Children related items' });
    expect(within(nested).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(
      await within(nested).findByRole('img', { name: /Latest saved version/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        loadVersions.mock.calls.some(
          ([reference]) => reference.modelZuid === childSchema.modelZuid,
        ),
      ).toBe(true),
    );
  });

  it('mounts related rows only after their parent expands', async () => {
    const onOpenDetails = vi.fn();
    render(rootTable({ onOpenDetails }));

    expect(
      screen.queryByRole('region', { name: 'Children related items' }),
    ).not.toBeInTheDocument();
    expandFirstParent();
    expect(
      await screen.findByRole('region', { name: 'Children related items' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Child 0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open details for Child 0' }));
    expect(onOpenDetails).toHaveBeenCalledWith(
      generated.children.items[0],
      expect.any(HTMLElement),
    );
  });

  it('preserves nested expansion while a filter temporarily hides every row', async () => {
    const grandchild: CollectionNode = {
      ...child,
      id: 'node-grandchild',
      name: 'Grandchildren',
      relationship: { kind: 'custom', parentField: ['title'], childField: ['title'] },
    };
    render(
      rootTable({
        treeRoot: { ...root, children: [{ ...child, children: [grandchild] }] },
        loadedView: {
          ...loadedView,
          schemas: new Map([...loadedView.schemas, [grandchild.id, childSchema]]),
        },
      }),
    );

    expandFirstParent();
    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    fireEvent.click(
      within(nestedTable).getByRole('button', {
        name: `Expand relationships for ${generated.children.items[0]!.id}`,
      }),
    );
    expect(
      await screen.findByRole('region', { name: 'Grandchildren related items' }),
    ).toBeInTheDocument();

    const filter = within(nestedTable).getByLabelText('Filter Children');
    fireEvent.change(filter, { target: { value: 'no matching child' } });
    expect(await screen.findByText('No related items match.')).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: '' } });

    expect(
      await screen.findByRole('region', { name: 'Grandchildren related items' }),
    ).toBeInTheDocument();
  });

  it('explains an empty root result and clears only the table search and filters', () => {
    const onPresentationChange = vi.fn();
    const noMatch: ViewFilter = {
      id: 'no-match',
      nodePath: [root.id],
      fieldPath: ['title'],
      operator: 'equals',
      value: 'nothing matches',
    };
    render(
      rootTable({
        treeRoot: {
          ...root,
          presentation: { ...root.presentation, filters: [noMatch], freeText: 'Parent' },
        },
        viewFilters: [noMatch],
        onPresentationChange,
      }),
    );

    const collection = screen.getByRole('region', { name: 'Parents collection' });
    expect(within(collection).getByText('No items match your search or filters')).toBeVisible();
    expect(
      within(collection).getByText(/View filters and the global search can also narrow/),
    ).toBeVisible();
    fireEvent.click(within(collection).getByRole('button', { name: 'Clear search and filters' }));

    expect(within(collection).getByLabelText('Filter this table')).toHaveValue('');
    expect(onPresentationChange).toHaveBeenLastCalledWith(
      root.id,
      expect.objectContaining({ filters: [], freeText: '' }),
    );
    // The view filter still applies, so the table stays empty but no longer offers a table reset.
    expect(within(collection).getByText('No items match your search or filters')).toBeVisible();
    expect(
      within(collection).queryByRole('button', { name: 'Clear search and filters' }),
    ).not.toBeInTheDocument();
  });

  it('sorts root and nested collections from their column headers', async () => {
    const onPresentationChange = vi.fn();
    render(rootTable({ onPresentationChange }));

    const rootTableRegion = screen.getByRole('region', { name: 'Parents collection' });
    fireEvent.click(within(rootTableRegion).getByRole('button', { name: 'Title' }));
    expect(within(rootTableRegion).getAllByRole('row')[1]).toHaveTextContent('Parent 0');

    expandFirstParent();
    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    fireEvent.click(within(nestedTable).getByRole('button', { name: 'Title' }));

    expect(onPresentationChange).toHaveBeenLastCalledWith(
      child.id,
      expect.objectContaining({
        sort: { fieldPath: ['fields', 'title'], direction: 'asc' },
      }),
    );
  });

  it('sorts a nullable numeric field named id instead of the technical ZUID', () => {
    const values = [null, 123_456, '', 999, 123.123] as const;
    const items = generated.parents.items.map((entry, index) => ({
      ...entry,
      fields: { id: values[index] },
    }));
    const snapshot = {
      ...generated.parents,
      items,
      itemsById: new Map(items.map((entry) => [entry.id, entry])),
    };
    const idSchema: CollectionSchema = {
      ...rootSchema,
      fields: [{ id: '12-id000000', name: 'id', label: 'Id', kind: 'number' }],
    };
    render(
      rootTable({
        schema: idSchema,
        snapshot,
        treeRoot: { ...root, children: [] },
        loadedView: {
          ...loadedView,
          snapshots: {
            snapshots: new Map([
              [snapshotQueryKey(root.reference, 'latest'), { status: 'complete', snapshot }],
            ]),
            totalItems: items.length,
          },
          schemas: new Map([[root.id, idSchema]]),
        },
      }),
    );

    const rootTableRegion = screen.getByRole('region', { name: 'Parents collection' });
    const idHeader = within(rootTableRegion).getByRole('button', { name: 'Id' });
    const rowItemIndexes = () =>
      within(rootTableRegion)
        .getAllByRole('row')
        .slice(1)
        .map((row) => items.findIndex((item) => row.textContent?.includes(item.id)));

    fireEvent.click(idHeader);
    expect(rowItemIndexes()).toEqual([1, 3, 4, 0, 2]);
    fireEvent.click(idHeader);
    expect(rowItemIndexes()).toEqual([4, 3, 1, 0, 2]);
  });

  it('clamps root and nested column resizes to the minimum width', async () => {
    const onPresentationChange = vi.fn();
    render(rootTable({ onPresentationChange }));

    dragBelowMinimumWidth(
      resizeHandle(screen.getByRole('region', { name: 'Parents collection' }), 'Title'),
    );
    expect(onPresentationChange).toHaveBeenLastCalledWith(root.id, {
      ...root.presentation,
      columnWidths: { title: 90 },
    });

    expandFirstParent();
    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    dragBelowMinimumWidth(resizeHandle(nestedTable, 'Title'));
    expect(onPresentationChange).toHaveBeenLastCalledWith(child.id, {
      ...child.presentation,
      visibleColumns: ['$id', '$status', 'title', 'parentKey'],
      statusColumnHidden: false,
      columnWidths: { title: 90 },
    });
  });

  it('keeps a nested load failure local and reveals its technical details', async () => {
    const failure: ExplorerError = {
      kind: 'decoding',
      message: 'Zesty returned model fields in an unsupported shape.',
      diagnostic: {
        operation: 'load-collection-schema',
        requestUrl: safeRequestUrl(
          'https://8-fixture-instance.api.zesty.io/v1/content/models/6-fixture-children/fields?lang=en-US',
        ),
        responseStatus: 200,
        issues: [{ path: '$.data', expected: 'array', received: 'object' }],
      },
    };
    render(
      rootTable({
        loadedView: {
          ...loadedView,
          snapshots: {
            ...loadedView.snapshots,
            snapshots: new Map([
              [
                snapshotQueryKey(root.reference, 'latest'),
                { status: 'complete', snapshot: generated.parents },
              ],
              [snapshotQueryKey(child.reference, 'latest'), { status: 'failed', error: failure }],
            ]),
          },
          schemas: new Map([[root.id, rootSchema]]),
          schemaErrors: new Map([[child.id, failure]]),
        },
      }),
    );
    expandFirstParent();

    expect(await screen.findByText(/Children: Zesty returned model fields/)).toBeVisible();
    expect(screen.queryByText('Loading collection schema')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    const technicalDetails = screen.getByLabelText('Technical error details');
    expect(technicalDetails).toHaveTextContent('Loading collection schema');
    expect(technicalDetails).toHaveTextContent('$.data');
  });

  it('shows ZUID first by default in root and nested tables and lets the user hide it', async () => {
    render(rootTable());

    const rootTableRegion = screen.getByRole('region', { name: 'Parents collection' });
    const rootHeaders = within(rootTableRegion).getAllByRole('columnheader');
    expect(rootHeaders[1]).toHaveAccessibleName('ZUID');
    expect(rootHeaders[2]).toHaveAccessibleName('Status');
    expect(rootHeaders[3]).toHaveAccessibleName('Title');

    const rootColumnsButton = within(rootTableRegion).getByRole('button', {
      name: 'Choose visible columns',
    });
    fireEvent.click(rootColumnsButton);
    const rootColumnControls = await screen.findAllByRole('menuitemcheckbox');
    expect(rootColumnControls[0]).toHaveAccessibleName('ZUID');
    const status = screen.getByRole('menuitemcheckbox', { name: 'Status' });
    expect(status).toBeChecked();
    fireEvent.click(status);
    expect(
      within(rootTableRegion).queryByRole('columnheader', { name: 'Status' }),
    ).not.toBeInTheDocument();
    expect(rootColumnsButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(status);
    const zuid = screen.getByRole('menuitemcheckbox', { name: 'ZUID' });
    expect(zuid).toBeChecked();
    fireEvent.click(zuid);
    expect(
      within(rootTableRegion).queryByRole('columnheader', { name: 'ZUID' }),
    ).not.toBeInTheDocument();
    fireEvent.click(rootColumnsButton);

    expandFirstParent();
    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    const nestedHeaders = within(nestedTable).getAllByRole('columnheader');
    expect(nestedHeaders[1]).toHaveAccessibleName('ZUID');
    expect(nestedHeaders[2]).toHaveAccessibleName('Status');
    expect(nestedHeaders[3]).toHaveAccessibleName('Title');
    fireEvent.click(within(nestedTable).getByRole('button', { name: 'Choose Children columns' }));
    const nestedColumnControls = await screen.findAllByRole('menuitemcheckbox');
    expect(nestedColumnControls[0]).toHaveAccessibleName('ZUID');
    expect(screen.getByRole('menuitemcheckbox', { name: 'ZUID' })).toBeChecked();
  });

  it('does not guess a Manager item URL for an unrecognized collection type', () => {
    const otherReference = { ...root.reference, area: 'other' as const };
    render(
      rootTable({
        reference: otherReference,
        treeRoot: { ...root, reference: otherReference, children: [] },
      }),
    );

    expect(screen.getAllByRole('button', { name: /Open details for/ })).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: /in Zesty Manager/ })).not.toBeInTheDocument();
  });

  it('preserves an explicit choice to hide every data column', async () => {
    render(
      rootTable({
        treeRoot: { ...root, presentation: { ...root.presentation, visibleColumns: [] } },
      }),
    );
    expect(screen.queryByRole('columnheader', { name: 'Title' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose visible columns' }));
    await screen.findAllByRole('menuitemcheckbox');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Title' })).not.toBeChecked();
    expect(screen.getByRole('menuitemcheckbox', { name: 'ZUID' })).not.toBeChecked();
  });

  it('restores a nested technical metadata sort in its column header', async () => {
    const onPresentationChange = vi.fn();
    const items = generated.children.items.map((item) => ({
      ...item,
      metadata: { ...item.metadata, workflowStatus: 'ready' },
    }));
    const snapshot = {
      ...generated.children,
      items,
      itemsById: new Map(items.map((item) => [item.id, item])),
    };
    const metadataChild: CollectionNode = {
      ...child,
      presentation: {
        ...child.presentation,
        visibleColumns: ['$id', '$meta.workflowStatus'],
        sort: { fieldPath: ['metadata', 'workflowStatus'], direction: 'asc' },
      },
    };
    render(
      rootTable({
        treeRoot: { ...root, children: [metadataChild] },
        loadedView: {
          ...loadedView,
          snapshots: {
            ...loadedView.snapshots,
            snapshots: new Map([
              ...loadedView.snapshots.snapshots,
              [
                snapshotQueryKey(metadataChild.reference, 'latest'),
                { status: 'complete', snapshot },
              ],
            ]),
          },
        },
        onPresentationChange,
      }),
    );
    expandFirstParent();

    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    fireEvent.click(within(nestedTable).getByRole('button', { name: 'workflowStatus' }));
    expect(onPresentationChange).toHaveBeenLastCalledWith(
      metadataChild.id,
      expect.objectContaining({
        sort: { fieldPath: ['metadata', 'workflowStatus'], direction: 'desc' },
      }),
    );
  });
});
