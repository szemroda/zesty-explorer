import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateRelationshipGraph,
  safeRequestUrl,
  type CollectionNode,
  type CollectionSchema,
  type ExplorerError,
} from '../../domain';
import { snapshotQueryKey } from '../../zesty-api';
import type { LoadedView } from '../load-view';
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
  id: 'node-child',
  name: 'Children',
  reference: {
    instanceZuid: '8-fixture-instance',
    modelZuid: '6-fixture-children',
    deployment: 'production',
    area: 'content',
    apiBaseUrl: 'https://8-fixture-instance.api.zesty.io/v1',
    managerBaseUrl: 'https://8-fixture-instance.manager.zesty.io',
  },
  relationship: {
    kind: 'custom',
    parentField: ['childKey'],
    childField: ['parentKey'],
  },
  presentation: {
    visibleColumns: ['*'],
    columnWidths: {},
    sort: { fieldPath: ['modified'], direction: 'desc' },
    filters: [],
    freeText: '',
  },
  children: [],
};
const root: CollectionNode = {
  id: 'node-root',
  name: 'Parents',
  reference: {
    instanceZuid: '8-fixture-instance',
    modelZuid: '6-fixture-parents',
    deployment: 'production',
    area: 'content',
    apiBaseUrl: 'https://8-fixture-instance.api.zesty.io/v1',
    managerBaseUrl: 'https://8-fixture-instance.manager.zesty.io',
  },
  presentation: child.presentation,
  children: [child],
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

afterEach(cleanup);

describe('recursive collection tables', () => {
  it('mounts related rows only after their parent expands', async () => {
    const details = vi.fn();
    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={root.reference}
        treeRoot={root}
        loadedView={loadedView}
        contentState="latest"
        onOpenDetails={details}
        onRetry={vi.fn()}
        onPresentationChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('region', { name: 'Children related items' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );
    expect(
      await screen.findByRole('region', { name: 'Children related items' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Child 0')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open details for Child 0',
      }),
    );
    expect(details).toHaveBeenCalledWith(generated.children.items[0], expect.any(HTMLElement));
  });

  it('preserves nested expansion while a filter temporarily hides every row', async () => {
    const grandchild: CollectionNode = {
      ...child,
      id: 'node-grandchild',
      name: 'Grandchildren',
      relationship: {
        kind: 'custom',
        parentField: ['title'],
        childField: ['title'],
      },
    };
    const childWithGrandchild = { ...child, children: [grandchild] };
    const rootWithGrandchild = { ...root, children: [childWithGrandchild] };
    const loadedViewWithGrandchild: LoadedView = {
      ...loadedView,
      schemas: new Map([...loadedView.schemas, [grandchild.id, childSchema]]),
    };

    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={root.reference}
        treeRoot={rootWithGrandchild}
        loadedView={loadedViewWithGrandchild}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );
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

  it('sorts root and nested collections from their column headers', async () => {
    const onPresentationChange = vi.fn();
    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={root.reference}
        treeRoot={root}
        loadedView={loadedView}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={onPresentationChange}
      />,
    );

    const rootTable = screen.getByRole('region', { name: 'Parents collection' });
    fireEvent.click(within(rootTable).getByRole('button', { name: 'Title' }));
    expect(within(rootTable).getAllByRole('row')[1]).toHaveTextContent('Parent 0');

    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );
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
    const rootWithoutChildren = { ...root, children: [] };
    const idLoadedView: LoadedView = {
      ...loadedView,
      snapshots: {
        snapshots: new Map([
          [snapshotQueryKey(root.reference, 'latest'), { status: 'complete', snapshot }],
        ]),
        totalItems: items.length,
      },
      schemas: new Map([[root.id, idSchema]]),
    };

    render(
      <RootTable
        schema={idSchema}
        snapshot={snapshot}
        reference={root.reference}
        treeRoot={rootWithoutChildren}
        loadedView={idLoadedView}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={vi.fn()}
      />,
    );

    const rootTable = screen.getByRole('region', { name: 'Parents collection' });
    const idHeader = within(rootTable).getByRole('button', { name: 'Id' });
    fireEvent.click(idHeader);
    let rows = within(rootTable).getAllByRole('row').slice(1);

    [1, 3, 4, 0, 2].forEach((itemIndex, rowIndex) => {
      expect(rows[rowIndex]).toHaveTextContent(items[itemIndex]!.id);
    });

    fireEvent.click(idHeader);
    rows = within(rootTable).getAllByRole('row').slice(1);
    [4, 3, 1, 0, 2].forEach((itemIndex, rowIndex) => {
      expect(rows[rowIndex]).toHaveTextContent(items[itemIndex]!.id);
    });
  });

  it('resizes root and nested columns from their headers', async () => {
    const onPresentationChange = vi.fn();
    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={root.reference}
        treeRoot={root}
        loadedView={loadedView}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={onPresentationChange}
      />,
    );

    const rootTable = screen.getByRole('region', { name: 'Parents collection' });
    const rootResizeHandle = within(rootTable).getByTitle('Resize Title column');
    fireEvent.mouseDown(rootResizeHandle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    fireEvent.mouseUp(document);
    expect(onPresentationChange).toHaveBeenLastCalledWith(root.id, {
      ...root.presentation,
      columnWidths: { title: 90 },
    });
    onPresentationChange.mockClear();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );
    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    const resizeHandle = within(nestedTable).getByTitle('Resize Title column');

    fireEvent.mouseDown(resizeHandle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    fireEvent.mouseUp(document);

    expect(onPresentationChange).toHaveBeenLastCalledWith(child.id, {
      ...child.presentation,
      visibleColumns: ['$id', 'title', 'parentKey'],
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
    const failedView: LoadedView = {
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
    };

    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={root.reference}
        treeRoot={root}
        loadedView={failedView}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );

    expect(await screen.findByText(/Children: Zesty returned model fields/)).toBeVisible();
    expect(screen.queryByText('Loading collection schema')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    const technicalDetails = screen.getByLabelText('Technical error details');
    expect(technicalDetails).toHaveTextContent('Loading collection schema');
    expect(technicalDetails).toHaveTextContent('$.data');
  });

  it('shows ZUID first by default in root and nested tables and lets the user hide it', async () => {
    render(
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
      />,
    );

    const rootTable = screen.getByRole('region', { name: 'Parents collection' });
    const rootHeaders = within(rootTable).getAllByRole('columnheader');
    expect(rootHeaders[1]).toHaveAccessibleName('ZUID');
    expect(rootHeaders[2]).toHaveAccessibleName('Title');

    const rootColumnsButton = within(rootTable).getByRole('button', {
      name: 'Choose visible columns',
    });
    fireEvent.click(rootColumnsButton);
    const rootColumnControls = await screen.findAllByRole('checkbox');
    expect(rootColumnControls[0]).toHaveAccessibleName('ZUID');
    const zuid = screen.getByRole('checkbox', { name: 'ZUID' });
    expect(zuid).toBeChecked();
    fireEvent.click(zuid);
    expect(within(rootTable).queryByRole('columnheader', { name: 'ZUID' })).not.toBeInTheDocument();
    fireEvent.click(rootColumnsButton);

    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );
    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    const nestedHeaders = within(nestedTable).getAllByRole('columnheader');
    expect(nestedHeaders[1]).toHaveAccessibleName('ZUID');
    expect(nestedHeaders[2]).toHaveAccessibleName('Title');
    fireEvent.click(
      within(nestedTable).getByRole('button', {
        name: 'Choose Children columns',
      }),
    );
    const nestedColumnControls = await screen.findAllByRole('checkbox');
    expect(nestedColumnControls[0]).toHaveAccessibleName('ZUID');
    expect(screen.getByRole('checkbox', { name: 'ZUID' })).toBeChecked();
  });

  it('does not guess a Manager item URL for an unrecognized collection type', () => {
    const otherReference = { ...root.reference, area: 'other' as const };
    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={otherReference}
        treeRoot={{ ...root, reference: otherReference, children: [] }}
        loadedView={loadedView}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /Open details for/ })).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: /in Zesty Manager/ })).not.toBeInTheDocument();
  });

  it('preserves an explicit choice to hide every data column', async () => {
    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={root.reference}
        treeRoot={{ ...root, presentation: { ...root.presentation, visibleColumns: [] } }}
        loadedView={loadedView}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: 'Title' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose visible columns' }));
    await screen.findAllByRole('checkbox');
    expect(screen.getByRole('checkbox', { name: 'Title' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ZUID' })).not.toBeChecked();
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
    const metadataRoot = { ...root, children: [metadataChild] };
    const metadataView: LoadedView = {
      ...loadedView,
      snapshots: {
        ...loadedView.snapshots,
        snapshots: new Map([
          ...loadedView.snapshots.snapshots,
          [snapshotQueryKey(metadataChild.reference, 'latest'), { status: 'complete', snapshot }],
        ]),
      },
    };

    render(
      <RootTable
        schema={rootSchema}
        snapshot={generated.parents}
        reference={metadataRoot.reference}
        treeRoot={metadataRoot}
        loadedView={metadataView}
        contentState="latest"
        onOpenDetails={vi.fn()}
        onRetry={vi.fn()}
        onPresentationChange={onPresentationChange}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );

    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    expect(within(nestedTable).getByRole('button', { name: 'workflowStatus' })).toBeInTheDocument();
    fireEvent.click(within(nestedTable).getByRole('button', { name: 'workflowStatus' }));
    expect(onPresentationChange).toHaveBeenLastCalledWith(
      metadataChild.id,
      expect.objectContaining({
        sort: { fieldPath: ['metadata', 'workflowStatus'], direction: 'desc' },
      }),
    );
  });
});
