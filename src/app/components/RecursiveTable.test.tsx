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
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('$modified');
    expect(screen.getByText('Child 0')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Open details for ${generated.children.items[0]!.id}`,
      }),
    );
    expect(details).toHaveBeenCalledWith(generated.children.items[0], expect.any(HTMLElement));
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

    const rootColumnControls = within(rootTable).getAllByRole('checkbox');
    expect(rootColumnControls[0]).toHaveAccessibleName('ZUID');
    const zuid = within(rootTable).getByRole('checkbox', { name: 'ZUID' });
    expect(zuid).toBeChecked();
    fireEvent.click(zuid);
    expect(within(rootTable).queryByRole('columnheader', { name: 'ZUID' })).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );
    const nestedTable = await screen.findByRole('region', { name: 'Children related items' });
    const nestedHeaders = within(nestedTable).getAllByRole('columnheader');
    expect(nestedHeaders[1]).toHaveAccessibleName('ZUID');
    expect(nestedHeaders[2]).toHaveAccessibleName('Title');
    const nestedColumnControls = within(nestedTable).getAllByRole('checkbox');
    expect(nestedColumnControls[0]).toHaveAccessibleName('ZUID');
    expect(within(nestedTable).getByRole('checkbox', { name: 'ZUID' })).toBeChecked();
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

  it('preserves an explicit choice to hide every data column', () => {
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
    expect(screen.getByRole('checkbox', { name: 'Title' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ZUID' })).not.toBeChecked();
  });

  it('restores a nested technical metadata sort in the selector', async () => {
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
        onPresentationChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: `Expand relationships for ${generated.parents.items[0]!.id}`,
      }),
    );

    expect(await screen.findByRole('combobox', { name: 'Sort' })).toHaveValue(
      '$meta.workflowStatus',
    );
  });
});
